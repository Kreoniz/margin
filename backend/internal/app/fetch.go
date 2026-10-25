package app

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/netip"
	"net/url"
	"strings"
	"time"

	"golang.org/x/net/idna"
)

var blockedPrefixes = func() []netip.Prefix {
	// Include special-purpose, documentation, benchmarking and transition ranges:
	// global-unicast alone does not imply a publicly routable address.
	var out []netip.Prefix
	for _, s := range strings.Fields("0.0.0.0/8 10.0.0.0/8 100.64.0.0/10 127.0.0.0/8 169.254.0.0/16 172.16.0.0/12 192.0.0.0/24 192.0.2.0/24 192.88.99.0/24 192.168.0.0/16 198.18.0.0/15 198.51.100.0/24 203.0.113.0/24 224.0.0.0/4 240.0.0.0/4 ::/96 ::ffff:0:0/96 64:ff9b::/96 64:ff9b:1::/48 100::/64 2001::/23 2001:db8::/32 2002::/16 3fff::/20 fc00::/7 fe80::/10 ff00::/8") {
		out = append(out, netip.MustParsePrefix(s))
	}
	return out
}()

func publicIP(ip netip.Addr) bool {
	ip = ip.Unmap()
	if !ip.IsValid() || !ip.IsGlobalUnicast() || ip.IsPrivate() || ip.IsLoopback() || ip.IsLinkLocalUnicast() {
		return false
	}
	for _, p := range blockedPrefixes {
		if p.Contains(ip) {
			return false
		}
	}
	return true
}

// CanonicalURL validates link syntax without resolving DNS and preserves path
// directory semantics. Duplicate-only normalization belongs in urlKey. Network
// fetches must additionally use Fetcher, which rejects private DNS at dial time.
func CanonicalURL(raw string) (string, error) {
	raw = strings.TrimSpace(raw)
	if len(raw) > 4096 {
		return "", errors.New("URL must be at most 4096 bytes")
	}
	u, err := url.Parse(raw)
	if err != nil || u == nil || !oneOf(strings.ToLower(u.Scheme), "http", "https") || u.Host == "" || u.Opaque != "" || u.User != nil {
		return "", errors.New("use a public http or https URL without credentials")
	}
	u.Scheme = strings.ToLower(u.Scheme)
	host := strings.TrimSuffix(strings.ToLower(u.Hostname()), ".")
	if strings.Contains(host, "%") {
		return "", errors.New("scoped addresses are not allowed")
	}
	if ip, err := netip.ParseAddr(host); err == nil {
		if !publicIP(ip) {
			return "", errors.New("private and special-use addresses are not allowed")
		}
		host = ip.Unmap().String()
	} else {
		host, err = idna.Lookup.ToASCII(host)
		if err != nil {
			return "", errors.New("invalid hostname")
		}
		if !strings.Contains(host, ".") || strings.ContainsAny(host, "\\ /\t\r\n") || strings.HasSuffix(host, ".localhost") || strings.HasSuffix(host, ".local") || strings.HasSuffix(host, ".internal") || strings.HasSuffix(host, ".test") || strings.HasSuffix(host, ".invalid") || strings.HasSuffix(host, ".home.arpa") {
			return "", errors.New("a public hostname is required")
		}
		// Browsers accept legacy abbreviated/decimal IPv4 notation. Public DNS
		// names cannot have an entirely numeric TLD, so reject these spellings.
		last := host[strings.LastIndexByte(host, '.')+1:]
		if strings.Trim(last, "0123456789") == "" || strings.HasPrefix(last, "0x") {
			return "", errors.New("ambiguous numeric hostname is not allowed")
		}
		for _, label := range strings.Split(host, ".") {
			if label == "" || len(label) > 63 || strings.HasPrefix(label, "-") || strings.HasSuffix(label, "-") {
				return "", errors.New("invalid hostname")
			}
			for _, c := range label {
				if !(c >= 'a' && c <= 'z' || c >= '0' && c <= '9' || c == '-') {
					return "", errors.New("invalid hostname")
				}
			}
		}
	}
	port := u.Port()
	if port != "" && port != "80" && port != "443" {
		return "", errors.New("only standard HTTP ports 80 and 443 are allowed")
	}
	u.Host = host
	if strings.Contains(host, ":") {
		u.Host = "[" + host + "]"
	}
	if port != "" && !(u.Scheme == "http" && port == "80" || u.Scheme == "https" && port == "443") {
		u.Host = net.JoinHostPort(host, port)
	}
	u.Fragment = ""
	u.RawFragment = ""
	if u.Path == "" {
		u.Path = "/"
	}
	// Decode unreserved escapes, preserve escaped slashes, and uppercase remaining
	// escapes. Do not path.Clean: servers may distinguish repeated slashes.
	escaped := u.EscapedPath()
	var path strings.Builder
	const digits = "0123456789ABCDEF"
	for i := 0; i < len(escaped); i++ {
		if escaped[i] == '%' && i+2 < len(escaped) {
			v := fromHex(escaped[i+1])*16 + fromHex(escaped[i+2])
			if v >= 'a' && v <= 'z' || v >= 'A' && v <= 'Z' || v >= '0' && v <= '9' || strings.ContainsRune("-._~", rune(v)) {
				path.WriteByte(v)
			} else {
				path.WriteByte('%')
				path.WriteByte(digits[v>>4])
				path.WriteByte(digits[v&15])
			}
			i += 2
		} else {
			path.WriteByte(escaped[i])
		}
	}
	u.RawPath = path.String()
	u.Path, _ = url.PathUnescape(u.RawPath)
	query, err := url.ParseQuery(u.RawQuery)
	if err != nil {
		return "", errors.New("invalid URL query")
	}
	for key := range query {
		lower := strings.ToLower(key)
		if strings.HasPrefix(lower, "utm_") || oneOf(lower, "fbclid", "gclid", "dclid", "msclkid", "mc_cid", "mc_eid", "igshid", "_ga", "_gl") {
			query.Del(key)
		}
	}
	u.RawQuery = query.Encode()
	u.ForceQuery = false
	return u.String(), nil
}

func fromHex(c byte) byte {
	if c >= '0' && c <= '9' {
		return c - '0'
	}
	if c >= 'a' && c <= 'f' {
		return c - 'a' + 10
	}
	return c - 'A' + 10
}
func urlKey(canonical string) string {
	u, _ := url.Parse(canonical)
	u.Scheme = "https"
	u.Host = strings.TrimPrefix(u.Host, "www.")
	// Preserve the existing duplicate identity without changing fetch/base URLs.
	// Trim the escaped path so an encoded slash never becomes a path separator.
	u.RawPath = strings.TrimRight(u.EscapedPath(), "/")
	if u.RawPath == "" {
		u.RawPath = "/"
	}
	u.Path, _ = url.PathUnescape(u.RawPath)
	return hash(u.String())
}
func safeLink(base, raw string) string {
	u, err := url.Parse(strings.TrimSpace(raw))
	if err != nil || raw == "" {
		return ""
	}
	b, err := url.Parse(base)
	if err != nil {
		return ""
	}
	out, err := CanonicalURL(b.ResolveReference(u).String())
	if err != nil {
		return ""
	}
	return out
}

type FetchResult struct {
	Body        []byte
	URL         string
	ContentType string
}
type Fetcher struct {
	client  *http.Client
	resolve func(context.Context, string) ([]netip.Addr, error)
	dial    func(context.Context, string, string) (net.Conn, error)
}

func NewFetcher() *Fetcher {
	d := &net.Dialer{Timeout: 5 * time.Second, KeepAlive: 30 * time.Second}
	f := &Fetcher{dial: d.DialContext}
	// LookupNetIP also takes a network argument; bind it explicitly below.
	f.resolve = func(ctx context.Context, host string) ([]netip.Addr, error) {
		return net.DefaultResolver.LookupNetIP(ctx, "ip", host)
	}
	transport := &http.Transport{Proxy: nil, DialContext: f.dialPublic, TLSHandshakeTimeout: 5 * time.Second, ResponseHeaderTimeout: 10 * time.Second, MaxResponseHeaderBytes: 64 << 10, IdleConnTimeout: 30 * time.Second, MaxIdleConns: 12, MaxConnsPerHost: 3, ForceAttemptHTTP2: true}
	f.client = &http.Client{Transport: transport, Timeout: 20 * time.Second, CheckRedirect: func(req *http.Request, via []*http.Request) error {
		if len(via) >= 5 {
			return errors.New("too many redirects")
		}
		_, err := CanonicalURL(req.URL.String())
		return err
	}}
	return f
}

func (f *Fetcher) dialPublic(ctx context.Context, network, addr string) (net.Conn, error) {
	host, port, err := net.SplitHostPort(addr)
	if err != nil {
		return nil, err
	}
	ips, err := f.resolve(ctx, host)
	if err != nil {
		return nil, fmt.Errorf("DNS lookup failed: %w", err)
	}
	if len(ips) == 0 {
		return nil, errors.New("hostname has no addresses")
	}
	// Reject mixed public/private answers rather than selecting a public answer.
	for _, ip := range ips {
		if !publicIP(ip) {
			return nil, errors.New("hostname resolves to a private or special-use address")
		}
	}
	var last error
	for _, ip := range ips {
		conn, err := f.dial(ctx, network, net.JoinHostPort(ip.Unmap().String(), port))
		if err == nil {
			return conn, nil
		}
		last = err
		if ctx.Err() != nil {
			break
		}
	}
	return nil, last
}

func (f *Fetcher) Get(ctx context.Context, raw string, maxBytes int64) (FetchResult, error) {
	u, err := CanonicalURL(raw)
	if err != nil {
		return FetchResult{}, err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u, nil)
	if err != nil {
		return FetchResult{}, err
	}
	req.Header.Set("User-Agent", "Margin/1.0 (personal reading inbox; RSS/metadata fetcher)")
	req.Header.Set("Accept", "application/atom+xml, application/rss+xml, application/xml, text/html, application/pdf;q=0.8, */*;q=0.5")
	res, err := f.client.Do(req)
	if err != nil {
		return FetchResult{}, err
	}
	defer res.Body.Close()
	if res.StatusCode < 200 || res.StatusCode >= 300 {
		return FetchResult{}, fmt.Errorf("remote server returned HTTP %d", res.StatusCode)
	}
	if res.ContentLength > maxBytes {
		return FetchResult{}, errors.New("remote response is too large")
	}
	body, err := io.ReadAll(io.LimitReader(res.Body, maxBytes+1))
	if err != nil {
		return FetchResult{}, fmt.Errorf("reading remote response: %w", err)
	}
	if int64(len(body)) > maxBytes {
		return FetchResult{}, errors.New("remote response is too large")
	}
	final, err := CanonicalURL(res.Request.URL.String())
	if err != nil {
		return FetchResult{}, err
	}
	return FetchResult{body, final, res.Header.Get("Content-Type")}, nil
}

func (f *Fetcher) Close() { f.client.CloseIdleConnections() }
