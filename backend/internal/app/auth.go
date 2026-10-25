package app

import (
	"context"
	"crypto/pbkdf2"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"errors"
	"net"
	"net/http"
	"net/netip"
	"strings"
	"sync"
	"time"
	"unicode/utf8"

	"github.com/jackc/pgx/v5"
)

const sessionCookie = "margin_session"
const sessionLifetime = 30 * 24 * time.Hour
const passwordIterations = 600000

var errConfigured = errors.New("owner already configured")
var errCredentials = errors.New("invalid credentials")

func randomSecret() string {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		panic(err)
	}
	return base64.RawURLEncoding.EncodeToString(b)
}

// ValidatePassword checks the shared browser/setup and deployment password policy.
func ValidatePassword(password string) error {
	if !utf8.ValidString(password) || utf8.RuneCountInString(password) < 12 || len(password) > 1024 {
		return &ValidationError{"password must contain at least 12 characters and at most 1024 bytes"}
	}
	return nil
}
func passwordHash(password string) (string, error) {
	if err := ValidatePassword(password); err != nil {
		return "", err
	}
	salt := randomSecret()
	key, err := pbkdf2.Key(sha256.New, password, []byte(salt), passwordIterations, 32)
	return "pbkdf2-sha256$600000$" + salt + "$" + base64.RawURLEncoding.EncodeToString(key), err
}
func passwordMatches(encoded, password string) bool {
	parts := strings.Split(encoded, "$")
	if len(parts) != 4 || parts[0] != "pbkdf2-sha256" || parts[1] != "600000" || len(password) > 1024 {
		return false
	}
	want, err := base64.RawURLEncoding.DecodeString(parts[3])
	if err != nil || len(want) != 32 {
		return false
	}
	got, err := pbkdf2.Key(sha256.New, password, []byte(parts[2]), passwordIterations, 32)
	return err == nil && subtle.ConstantTimeCompare(got, want) == 1
}

// ConfigureOwner supplies an optional deployment password. An unchanged password
// preserves sessions; a changed password revokes them. No plaintext is persisted.
func (s *Store) ConfigureOwner(ctx context.Context, password string) error {
	if password == "" {
		return nil
	}
	if err := ValidatePassword(password); err != nil {
		return err
	}
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	if _, err = tx.Exec(ctx, "SELECT pg_advisory_xact_lock(6842148804)"); err != nil {
		return err
	}
	var existing string
	err = tx.QueryRow(ctx, "SELECT password_hash FROM owner_credentials WHERE singleton FOR UPDATE").Scan(&existing)
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return err
	}
	if passwordMatches(existing, password) {
		return tx.Commit(ctx)
	}
	encoded, err := passwordHash(password)
	if err != nil {
		return err
	}
	if _, err = tx.Exec(ctx, "INSERT INTO owner_credentials(password_hash) VALUES($1) ON CONFLICT(singleton) DO UPDATE SET password_hash=EXCLUDED.password_hash", encoded); err != nil {
		return err
	}
	if _, err = tx.Exec(ctx, "DELETE FROM owner_sessions"); err != nil {
		return err
	}
	return tx.Commit(ctx)
}
func (s *Store) configured(ctx context.Context) (bool, error) {
	var configured bool
	err := s.Pool.QueryRow(ctx, "SELECT EXISTS(SELECT 1 FROM owner_credentials)").Scan(&configured)
	return configured, err
}
func (s *Store) newOwnerSession(ctx context.Context, password string, setup bool) (string, error) {
	if err := ValidatePassword(password); err != nil {
		return "", err
	}
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return "", err
	}
	defer tx.Rollback(ctx)
	if setup {
		// Same lock as environment configuration makes concurrent first setup atomic.
		if _, err = tx.Exec(ctx, "SELECT pg_advisory_xact_lock(6842148804)"); err != nil {
			return "", err
		}
		var exists bool
		if err = tx.QueryRow(ctx, "SELECT EXISTS(SELECT 1 FROM owner_credentials)").Scan(&exists); err != nil {
			return "", err
		}
		if exists {
			return "", errConfigured
		}
		encoded, e := passwordHash(password)
		if e != nil {
			return "", e
		}
		if _, err = tx.Exec(ctx, "INSERT INTO owner_credentials(password_hash) VALUES($1)", encoded); err != nil {
			return "", err
		}
	} else {
		var encoded string
		err = tx.QueryRow(ctx, "SELECT password_hash FROM owner_credentials WHERE singleton FOR SHARE").Scan(&encoded)
		if errors.Is(err, pgx.ErrNoRows) {
			return "", errCredentials
		}
		if err != nil {
			return "", err
		}
		if !passwordMatches(encoded, password) {
			return "", errCredentials
		}
	}
	token := randomSecret()
	if _, err = tx.Exec(ctx, "DELETE FROM owner_sessions WHERE expires_at<=now()"); err != nil {
		return "", err
	}
	// Bound stored sessions, even with repeated successful login.
	if _, err = tx.Exec(ctx, "DELETE FROM owner_sessions WHERE token_hash IN (SELECT token_hash FROM owner_sessions ORDER BY expires_at DESC OFFSET 19)"); err != nil {
		return "", err
	}
	if _, err = tx.Exec(ctx, "INSERT INTO owner_sessions(token_hash,expires_at) VALUES($1,now()+interval '30 days')", hash(token)); err != nil {
		return "", err
	}
	return token, tx.Commit(ctx)
}
func (s *Server) authenticated(r *http.Request) (bool, error) {
	c, err := r.Cookie(sessionCookie)
	if err != nil || len(c.Value) != 43 {
		return false, nil
	}
	var ok bool
	err = s.Store.Pool.QueryRow(r.Context(), "SELECT EXISTS(SELECT 1 FROM owner_sessions WHERE token_hash=$1 AND expires_at>now())", hash(c.Value)).Scan(&ok)
	return ok, err
}

type sessionState struct {
	Authenticated bool `json:"authenticated"`
	SetupRequired bool `json:"setup_required"`
}

func (s *Server) session(w http.ResponseWriter, r *http.Request) {
	configured, err := s.Store.configured(r.Context())
	if err != nil {
		respond(w, 200, nil, err)
		return
	}
	auth, err := s.authenticated(r)
	respond(w, 200, sessionState{auth, !configured}, err)
}
func setSessionCookie(w http.ResponseWriter, r *http.Request, token string) {
	http.SetCookie(w, &http.Cookie{Name: sessionCookie, Value: token, Path: "/", HttpOnly: true, SameSite: http.SameSiteLaxMode, Secure: r.TLS != nil || strings.EqualFold(r.Header.Get("X-Forwarded-Proto"), "https"), MaxAge: int(sessionLifetime.Seconds()), Expires: time.Now().Add(sessionLifetime)})
}
func (s *Server) signIn(w http.ResponseWriter, r *http.Request, setup bool) {
	if setup {
		configured, err := s.Store.configured(r.Context())
		if err != nil {
			respond(w, 200, nil, err)
			return
		}
		if configured {
			writeJSON(w, 409, map[string]string{"error": "Owner is already configured"})
			return
		}
	}
	if !s.limiter.allow(s.clientAddress(r), time.Now()) {
		w.Header().Set("Retry-After", "60")
		writeJSON(w, 429, map[string]string{"error": "Too many attempts; try again shortly"})
		return
	}
	var in struct {
		Password string `json:"password"`
	}
	if !decode(w, r, &in) {
		return
	}
	token, err := s.Store.newOwnerSession(r.Context(), in.Password, setup)
	switch {
	case errors.Is(err, errConfigured):
		writeJSON(w, 409, map[string]string{"error": "Owner is already configured"})
	case errors.Is(err, errCredentials):
		writeJSON(w, 401, map[string]string{"error": "Invalid password"})
	case err != nil:
		respond(w, 200, nil, err)
	default:
		setSessionCookie(w, r, token)
		status := 200
		if setup {
			status = 201
		}
		writeJSON(w, status, sessionState{true, false})
	}
}
func (s *Server) logout(w http.ResponseWriter, r *http.Request) {
	if c, err := r.Cookie(sessionCookie); err == nil {
		if _, err = s.Store.Pool.Exec(r.Context(), "DELETE FROM owner_sessions WHERE token_hash=$1", hash(c.Value)); err != nil {
			respond(w, 204, nil, err)
			return
		}
	}
	http.SetCookie(w, &http.Cookie{Name: sessionCookie, Value: "", Path: "/", HttpOnly: true, SameSite: http.SameSiteLaxMode, Secure: r.TLS != nil || strings.EqualFold(r.Header.Get("X-Forwarded-Proto"), "https"), MaxAge: -1, Expires: time.Unix(1, 0)})
	writeJSON(w, 204, nil)
}

// ParseTrustedProxies parses a comma-separated list of exact proxy IP prefixes.
// Only /32 (IPv4) and /128 (IPv6) are accepted. Empty configuration trusts none.
func ParseTrustedProxies(value string) ([]netip.Prefix, error) {
	if strings.TrimSpace(value) == "" {
		return nil, nil
	}
	var trusted []netip.Prefix
	for _, part := range strings.Split(value, ",") {
		prefix, err := netip.ParsePrefix(strings.TrimSpace(part))
		if err != nil || prefix.Bits() != prefix.Addr().BitLen() {
			return nil, errors.New("invalid trusted proxy configuration: expected exact IP prefixes (/32 or /128)")
		}
		addr := prefix.Addr().Unmap()
		trusted = append(trusted, netip.PrefixFrom(addr, addr.BitLen()))
	}
	return trusted, nil
}

func (s *Server) trustedProxy(addr netip.Addr) bool {
	for _, prefix := range s.TrustedProxies {
		// Fail closed even if a caller bypasses ParseTrustedProxies.
		if prefix.IsValid() && prefix.Bits() == prefix.Addr().BitLen() && prefix.Addr().Unmap() == addr {
			return true
		}
	}
	return false
}

func (s *Server) clientAddress(r *http.Request) string {
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		host = r.RemoteAddr
	}
	peer, err := netip.ParseAddr(host)
	if err != nil || peer.Zone() != "" {
		return r.RemoteAddr
	}
	peer = peer.Unmap()
	if !s.trustedProxy(peer) {
		return peer.String()
	}
	// Multiple header lines form one chain. Bound both bytes and hops before
	// allocating or parsing it, and fall back to the peer on malformed input.
	values := r.Header.Values("X-Forwarded-For")
	length, hops := 0, 0
	for i, value := range values {
		length += len(value)
		if i > 0 {
			length++
		}
		if length > 4096 {
			return peer.String()
		}
		hops += strings.Count(value, ",") + 1
		if hops > 16 {
			return peer.String()
		}
	}
	if hops == 0 {
		return peer.String()
	}
	chain := make([]netip.Addr, 0, hops)
	for _, part := range strings.Split(strings.Join(values, ","), ",") {
		addr, err := netip.ParseAddr(strings.TrimSpace(part))
		if err != nil || addr.Zone() != "" {
			return peer.String()
		}
		chain = append(chain, addr.Unmap())
	}
	// Walk from the immediate peer toward the client, stopping at the first
	// untrusted hop. A client-supplied leftmost value cannot override that hop.
	client := peer
	for i := len(chain) - 1; i >= 0 && s.trustedProxy(client); i-- {
		client = chain[i]
	}
	return client.String()
}

// Fixed-memory limiter: clients cannot grow the map or bypass a global budget by
// rotating addresses, including addresses supplied by a trusted proxy.
type loginAttempt struct {
	start time.Time
	count int
}
type loginLimiter struct {
	mu      sync.Mutex
	clients map[string]loginAttempt
	global  loginAttempt
}

func (l *loginLimiter) allow(addr string, now time.Time) bool {
	l.mu.Lock()
	defer l.mu.Unlock()
	if now.Sub(l.global.start) >= time.Minute {
		l.global = loginAttempt{start: now}
	}
	if l.global.count >= 100 {
		return false
	}
	if l.clients == nil {
		l.clients = map[string]loginAttempt{}
	}
	host, _, err := net.SplitHostPort(addr)
	if err != nil {
		host = addr
	}
	a := l.clients[host]
	if now.Sub(a.start) >= time.Minute {
		a = loginAttempt{start: now}
	}
	if a.count >= 10 {
		return false
	}
	if _, ok := l.clients[host]; !ok && len(l.clients) >= 1024 {
		for key, item := range l.clients {
			if now.Sub(item.start) >= time.Minute {
				delete(l.clients, key)
			}
		}
		if len(l.clients) >= 1024 {
			return false
		}
	}
	l.global.count++
	a.count++
	l.clients[host] = a
	return true
}
