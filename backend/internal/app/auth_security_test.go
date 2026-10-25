package app

import (
	"context"
	"fmt"
	"net/http/httptest"
	"net/netip"
	"reflect"
	"strings"
	"testing"
	"time"
)

func TestParseTrustedProxies(t *testing.T) {
	for _, value := range []string{"", " \t\n"} {
		prefixes, err := ParseTrustedProxies(value)
		if err != nil || len(prefixes) != 0 {
			t.Fatalf("empty configuration: %v %v", prefixes, err)
		}
	}
	prefixes, err := ParseTrustedProxies(" 172.30.0.4/32, 2001:db8::4/128, ::ffff:192.0.2.4/128 ")
	want := []netip.Prefix{netip.MustParsePrefix("172.30.0.4/32"), netip.MustParsePrefix("2001:db8::4/128"), netip.MustParsePrefix("192.0.2.4/32")}
	if err != nil || !reflect.DeepEqual(prefixes, want) {
		t.Fatalf("exact prefixes: %v %v", prefixes, err)
	}
	for _, value := range []string{"0.0.0.0/0", "172.30.0.4/24", "::/0", "2001:db8::/64", "::ffff:192.0.2.0/120", "172.30.0.4", "proxy.example/32", "private-value", "172.30.0.4/32,", ",172.30.0.4/32"} {
		prefixes, err := ParseTrustedProxies(value)
		if err == nil || prefixes != nil {
			t.Fatalf("invalid configuration accepted: %q", value)
		}
		if err.Error() != "invalid trusted proxy configuration: expected exact IP prefixes (/32 or /128)" {
			t.Fatalf("configuration error must not echo input: %v", err)
		}
	}
}

func TestLoginClientAddress(t *testing.T) {
	for _, tc := range []struct {
		name, peer, proxies string
		forwarded           []string
		want                string
	}{
		{"default ignores spoofed header", "192.0.2.4:1234", "", []string{"198.51.100.1"}, "192.0.2.4"},
		{"untrusted peer", "192.0.2.5:1234", "192.0.2.4/32", []string{"198.51.100.1"}, "192.0.2.5"},
		{"trusted direct proxy", "192.0.2.4:1234", "192.0.2.4/32", []string{"198.51.100.1"}, "198.51.100.1"},
		{"spoofed leftmost address", "192.0.2.4:1234", "192.0.2.4/32", []string{"203.0.113.9, 198.51.100.1"}, "198.51.100.1"},
		{"trusted proxy chain", "192.0.2.4:1234", "192.0.2.4/32,192.0.2.5/32", []string{"203.0.113.9, 198.51.100.1, 192.0.2.5"}, "198.51.100.1"},
		{"multiple header lines", "192.0.2.4:1234", "192.0.2.4/32,192.0.2.5/32", []string{"203.0.113.9, 198.51.100.1", "192.0.2.5"}, "198.51.100.1"},
		{"IPv6 client", "192.0.2.4:1234", "192.0.2.4/32", []string{"2001:db8::1"}, "2001:db8::1"},
		{"IPv6 proxy", "[2001:db8::4]:1234", "2001:db8::4/128", []string{"198.51.100.1"}, "198.51.100.1"},
		{"mapped IPv4 normalization", "[::ffff:192.0.2.4]:1234", "192.0.2.4/32", []string{"::ffff:198.51.100.1"}, "198.51.100.1"},
		{"no header", "192.0.2.4:1234", "192.0.2.4/32", nil, "192.0.2.4"},
		{"invalid address", "192.0.2.4:1234", "192.0.2.4/32", []string{"not-an-ip"}, "192.0.2.4"},
		{"invalid chain", "192.0.2.4:1234", "192.0.2.4/32", []string{"198.51.100.1, not-an-ip"}, "192.0.2.4"},
		{"empty hop", "192.0.2.4:1234", "192.0.2.4/32", []string{"198.51.100.1,,192.0.2.4"}, "192.0.2.4"},
		{"address with port", "192.0.2.4:1234", "192.0.2.4/32", []string{"198.51.100.1:80"}, "192.0.2.4"},
		{"zone rejected", "192.0.2.4:1234", "192.0.2.4/32", []string{"fe80::1%eth0"}, "192.0.2.4"},
		{"too many hops", "192.0.2.4:1234", "192.0.2.4/32", []string{strings.Repeat("198.51.100.1,", 16) + "198.51.100.2"}, "192.0.2.4"},
		{"oversized header", "192.0.2.4:1234", "192.0.2.4/32", []string{strings.Repeat(" ", 4096) + "198.51.100.1"}, "192.0.2.4"},
		{"invalid peer", "not-an-ip:1234", "192.0.2.4/32", []string{"198.51.100.1"}, "not-an-ip:1234"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			proxies, err := ParseTrustedProxies(tc.proxies)
			if err != nil {
				t.Fatal(err)
			}
			s := &Server{TrustedProxies: proxies}
			r := httptest.NewRequest("POST", "/api/login", nil)
			r.RemoteAddr = tc.peer
			for _, value := range tc.forwarded {
				r.Header.Add("X-Forwarded-For", value)
			}
			r.Header.Set("X-Real-IP", "203.0.113.10")
			r.Header.Set("Forwarded", "for=203.0.113.10")
			if got := s.clientAddress(r); got != tc.want {
				t.Fatalf("client=%q want %q", got, tc.want)
			}
		})
	}
	// A direct field assignment must not silently enable broad subnet trust.
	s := &Server{TrustedProxies: []netip.Prefix{netip.MustParsePrefix("192.0.2.0/24"), {}}}
	r := httptest.NewRequest("POST", "/api/login", nil)
	r.RemoteAddr = "192.0.2.4:1234"
	r.Header.Set("X-Forwarded-For", "198.51.100.1")
	if got := s.clientAddress(r); got != "192.0.2.4" {
		t.Fatalf("broad proxy prefix trusted: %q", got)
	}
}

func TestLoginLimiterProxyClientBudgets(t *testing.T) {
	for _, tc := range []struct {
		name, proxies string
		trusted       bool
	}{
		{"default", "", false},
		{"untrusted peer", "192.0.2.5/32", false},
		{"trusted peer", "192.0.2.4/32", true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			proxies, err := ParseTrustedProxies(tc.proxies)
			if err != nil {
				t.Fatal(err)
			}
			s := &Server{TrustedProxies: proxies}
			handler := s.Handler()
			request := func(attempt int, forwarded string) *httptest.ResponseRecorder {
				// Malformed JSON reaches the limiter without needing PostgreSQL.
				r := httptest.NewRequest("POST", "/api/login", strings.NewReader("{"))
				r.RemoteAddr = fmt.Sprintf("192.0.2.4:%d", 1000+attempt)
				r.Header.Set("X-Forwarded-For", forwarded)
				w := httptest.NewRecorder()
				handler.ServeHTTP(w, r)
				return w
			}
			for i := range 10 {
				forwarded := "198.51.100.1"
				if !tc.trusted {
					forwarded = fmt.Sprintf("198.51.100.%d", i+1)
				}
				requireCode(t, request(i, forwarded), 400)
			}
			w := request(10, "198.51.100.1")
			requireCode(t, w, 429)
			if w.Header().Get("Retry-After") != "60" {
				t.Fatal("missing retry interval")
			}
			want := 429
			if tc.trusted {
				want = 400
			}
			requireCode(t, request(11, "198.51.100.2"), want)
		})
	}
}

func TestLoginLimiterTrustedProxyGlobalBudget(t *testing.T) {
	s := &Server{TrustedProxies: []netip.Prefix{netip.MustParsePrefix("192.0.2.4/32")}}
	now := time.Now()
	for i := range 101 {
		r := httptest.NewRequest("POST", "/api/login", nil)
		r.RemoteAddr = "192.0.2.4:1234"
		r.Header.Set("X-Forwarded-For", fmt.Sprintf("198.51.100.%d", i+1))
		if allowed := s.limiter.allow(s.clientAddress(r), now); allowed != (i < 100) {
			t.Fatalf("global budget: attempt=%d allowed=%v", i+1, allowed)
		}
	}
}

func TestConfiguredSetupDoesNotConsumeLoginBudget(t *testing.T) {
	store := integrationStore(t)
	if err := store.ConfigureOwner(context.Background(), "configured-password-long"); err != nil {
		t.Fatal(err)
	}
	for _, exhausted := range []bool{false, true} {
		t.Run(fmt.Sprintf("exhausted=%v", exhausted), func(t *testing.T) {
			s := &Server{Store: store}
			if exhausted {
				s.limiter.global = loginAttempt{start: time.Now(), count: 100}
			}
			before := s.limiter.global
			c := &apiTestClient{t: t, handler: s.Handler()}
			for range 101 {
				requireCode(t, c.request("POST", "/api/setup", "{"), 409)
			}
			if s.limiter.global != before || len(s.limiter.clients) != 0 {
				t.Fatal("configured setup consumed sign-in budget")
			}
			if !exhausted {
				requireCode(t, c.request("POST", "/api/login", `{"password":"configured-password-long"}`), 200)
			}
		})
	}
}
