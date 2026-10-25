package app

import (
	"bufio"
	"context"
	"errors"
	"io"
	"net"
	"net/http"
	"net/netip"
	"strings"
	"testing"
	"time"
)

type roundTripFunc func(*http.Request) (*http.Response, error)

func (f roundTripFunc) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }
func fakeResponse(r *http.Request, status int, ct, body string) *http.Response {
	return &http.Response{StatusCode: status, Header: http.Header{"Content-Type": []string{ct}}, Body: io.NopCloser(strings.NewReader(body)), ContentLength: -1, Request: r}
}

func TestCanonicalURL(t *testing.T) {
	cases := map[string]string{
		"HTTPS://Example.COM.:443/a/%7euser/?utm_source=test&b=2&a=1#hello": "https://example.com/a/~user/?a=1&b=2",
		"https://example.com":                        "https://example.com/",
		"https://example.com/a%2fb?gclid=gone&q=a+b": "https://example.com/a%2Fb?q=a+b",
		"https://example.com/blog//":                 "https://example.com/blog//",
		"https://example.com/a%2f/":                  "https://example.com/a%2F/",
		"https://BÜCHER.de/":                         "https://xn--bcher-kva.de/",
	}
	for raw, want := range cases {
		got, err := CanonicalURL(raw)
		if err != nil || got != want {
			t.Errorf("%q: got %q, %v; want %q", raw, got, err, want)
		}
		again, err := CanonicalURL(got)
		if err != nil || again != got {
			t.Errorf("not idempotent: %q -> %q", got, again)
		}
	}
	for _, raw := range []string{"file:///etc/passwd", "javascript:alert(1)", "ftp://example.com", "https://user:pass@example.com", "http://localhost", "http://127.0.0.1", "http://127.1", "http://10.0.0.1", "http://169.254.169.254/latest/meta-data", "http://[::1]/", "http://[::ffff:127.0.0.1]/", "http://[fe80::1%25eth0]/", "https://example.com:8080", "http://printer.local", "http://[64:ff9b::7f00:1]/", "https://example.com/%gg"} {
		if got, err := CanonicalURL(raw); err == nil {
			t.Errorf("unsafe URL accepted: %q -> %q", raw, got)
		}
	}
	a, _ := CanonicalURL("http://www.example.com/post/?utm_medium=x")
	b, _ := CanonicalURL("https://example.com/post")
	if urlKey(a) != urlKey(b) {
		t.Fatal("scheme/www/trailing slash variants are not duplicates")
	}
	if urlKey("https://example.com/a%2F/") != urlKey("https://example.com/a%2F") || urlKey("https://example.com/a%2F") == urlKey("https://example.com/a/") {
		t.Fatal("duplicate keys lost escaped slash semantics")
	}
}

func TestFetchPreservesDirectoryURLs(t *testing.T) {
	for _, input := range []string{"https://example.com/blog/", "https://example.com/start/"} {
		t.Run(input, func(t *testing.T) {
			f := NewFetcher()
			defer f.Close()
			f.client.Transport = roundTripFunc(func(r *http.Request) (*http.Response, error) {
				switch r.URL.Path {
				case "/start/":
					res := fakeResponse(r, 302, "text/html", "")
					res.Header.Set("Location", "/blog/")
					return res, nil
				case "/blog/":
					return fakeResponse(r, 200, "text/html", "Directory page"), nil
				default:
					t.Errorf("directory semantics changed: %s", r.URL)
					return fakeResponse(r, 404, "text/plain", "missing"), nil
				}
			})
			res, err := f.Get(context.Background(), input, 100)
			if err != nil || res.URL != "https://example.com/blog/" {
				t.Fatalf("final directory URL: %+v %v", res, err)
			}
		})
	}
}

func TestMetadataResolvesRelativeDirectoryLinks(t *testing.T) {
	f := NewFetcher()
	defer f.Close()
	f.client.Transport = roundTripFunc(func(r *http.Request) (*http.Response, error) {
		switch r.URL.Path {
		case "/start":
			res := fakeResponse(r, 302, "text/html", "")
			res.Header.Set("Location", "/blog/")
			return res, nil
		case "/blog/":
			return fakeResponse(r, 200, "text/html", `<title>Directory article</title><meta property="og:image" content="images/cover.jpg"><link rel="canonical" href="article/">`), nil
		default:
			return fakeResponse(r, 404, "text/plain", "missing"), nil
		}
	})
	m, err := f.Metadata(context.Background(), "https://example.com/start")
	if err != nil || m.Warning != "" || m.URL != "https://example.com/blog/article/" || m.CoverURL != "https://example.com/blog/images/cover.jpg" {
		t.Fatalf("relative metadata: %+v %v", m, err)
	}
}

func TestDialRejectsPrivateDNSAndPinsPublicIP(t *testing.T) {
	f := NewFetcher()
	defer f.Close()
	dialed := false
	f.dial = func(_ context.Context, _ string, addr string) (net.Conn, error) {
		dialed = true
		if addr != "93.184.216.34:443" {
			t.Errorf("dial was not pinned: %s", addr)
		}
		return nil, errors.New("test dial")
	}
	for _, addresses := range [][]netip.Addr{{netip.MustParseAddr("127.0.0.1")}, {netip.MustParseAddr("93.184.216.34"), netip.MustParseAddr("10.1.2.3")}, {netip.MustParseAddr("::ffff:192.168.0.1")}, {netip.MustParseAddr("100.100.100.200")}} {
		f.resolve = func(context.Context, string) ([]netip.Addr, error) { return addresses, nil }
		if _, err := f.dialPublic(context.Background(), "tcp", "public.example.com:443"); err == nil {
			t.Fatal("private DNS accepted")
		}
		if dialed {
			t.Fatal("dialed a private DNS answer")
		}
	}
	f.resolve = func(context.Context, string) ([]netip.Addr, error) {
		return []netip.Addr{netip.MustParseAddr("93.184.216.34")}, nil
	}
	f.dialPublic(context.Background(), "tcp", "public.example.com:443")
	if !dialed {
		t.Fatal("public address was not dialed")
	}
}

func TestFetchRejectsRedirectsAndOversizedBodies(t *testing.T) {
	for _, target := range []string{"http://127.0.0.1/secret", "http://[::1]/", "http://169.254.169.254/", "file:///etc/passwd"} {
		t.Run(target, func(t *testing.T) {
			f := NewFetcher()
			defer f.Close()
			calls := 0
			f.client.Transport = roundTripFunc(func(r *http.Request) (*http.Response, error) {
				calls++
				res := fakeResponse(r, 302, "text/html", "")
				res.Header.Set("Location", target)
				return res, nil
			})
			if _, err := f.Get(context.Background(), "https://example.com/", 100); err == nil {
				t.Fatal("unsafe redirect followed")
			}
			if calls != 1 {
				t.Fatalf("made %d requests", calls)
			}
		})
	}
	f := NewFetcher()
	defer f.Close()
	f.client.Transport = roundTripFunc(func(r *http.Request) (*http.Response, error) {
		return fakeResponse(r, 200, "text/html", strings.Repeat("a", 101)), nil
	})
	if _, err := f.Get(context.Background(), "https://example.com/", 100); err == nil {
		t.Fatal("oversized unknown-length body accepted")
	}
	calls := 0
	f.client.Transport = roundTripFunc(func(r *http.Request) (*http.Response, error) {
		calls++
		res := fakeResponse(r, 302, "text/html", "")
		res.Header.Set("Location", "https://example.com/loop")
		return res, nil
	})
	if _, err := f.Get(context.Background(), "https://example.com/", 100); err == nil || calls != 5 {
		t.Fatalf("redirect bound: calls=%d err=%v", calls, err)
	}
}

func TestFetchRedirectRejectsPrivateDNS(t *testing.T) {
	f := NewFetcher()
	defer f.Close()
	dials := 0
	f.resolve = func(_ context.Context, host string) ([]netip.Addr, error) {
		if host == "private.example.com" {
			return []netip.Addr{netip.MustParseAddr("192.168.1.1")}, nil
		}
		return []netip.Addr{netip.MustParseAddr("93.184.216.34")}, nil
	}
	f.dial = func(_ context.Context, _, address string) (net.Conn, error) {
		dials++
		if address != "93.184.216.34:80" {
			t.Errorf("unexpected pinned address: %s", address)
		}
		client, server := net.Pipe()
		go func() {
			defer server.Close()
			if _, err := http.ReadRequest(bufio.NewReader(server)); err != nil {
				return
			}
			io.WriteString(server, "HTTP/1.1 302 Found\r\nLocation: http://private.example.com/secret\r\nContent-Length: 0\r\nConnection: close\r\n\r\n")
		}()
		return client, nil
	}
	if _, err := f.Get(context.Background(), "http://example.com/", 100); err == nil {
		t.Fatal("followed redirect to a hostname with private DNS")
	}
	if dials != 1 {
		t.Fatalf("dialed %d destinations", dials)
	}
}

func TestMetadataAndFallback(t *testing.T) {
	f := NewFetcher()
	defer f.Close()
	f.client.Transport = roundTripFunc(func(r *http.Request) (*http.Response, error) {
		return fakeResponse(r, 200, "text/html; charset=utf-8", `<title>Fallback</title><meta property="og:title" content="A useful article"><meta name="author" content="A Writer"><meta name="description" content="An overview."><meta property="og:image" content="/cover.jpg"><link rel="canonical" href="https://example.com/canonical?utm_source=x">`), nil
	})
	m, err := f.Metadata(context.Background(), "https://example.com/post")
	if err != nil || m.Title != "A useful article" || m.Author != "A Writer" || m.CoverURL != "https://example.com/cover.jpg" || m.URL != "https://example.com/canonical" {
		t.Fatalf("metadata: %+v %v", m, err)
	}
	f.client.Transport = roundTripFunc(func(r *http.Request) (*http.Response, error) {
		return fakeResponse(r, 200, "application/pdf", "%PDF-1.7"), nil
	})
	m, err = f.Metadata(context.Background(), "https://example.com/download")
	if err != nil || m.Kind != "paper" || m.Warning == "" {
		t.Fatalf("PDF: %+v %v", m, err)
	}
	f.client.Transport = roundTripFunc(func(r *http.Request) (*http.Response, error) { return nil, errors.New("remote unavailable") })
	m, err = f.Metadata(context.Background(), "https://example.com/my-paper.pdf")
	if err != nil || m.Kind != "paper" || m.Title != "my paper" || m.Warning == "" {
		t.Fatalf("fallback: %+v %v", m, err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), time.Millisecond)
	defer cancel()
	f.client.Transport = roundTripFunc(func(r *http.Request) (*http.Response, error) { <-r.Context().Done(); return nil, r.Context().Err() })
	if _, err = f.Get(ctx, "https://example.com/", 100); err == nil {
		t.Fatal("context timeout ignored")
	}
}
