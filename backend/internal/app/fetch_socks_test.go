package app

import (
	"bufio"
	"context"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/tls"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/binary"
	"errors"
	"fmt"
	"io"
	"math/big"
	"net"
	"net/http"
	"net/netip"
	"strconv"
	"strings"
	"testing"
	"time"
)

func TestFetcherSOCKSConfig(t *testing.T) {
	for _, c := range []FetcherConfig{
		{},
		{SOCKSProxyAddress: "172.30.0.1:11080", SOCKSProxyHosts: "ThinkingMachines.ai, www.thinkingmachines.ai"},
		{SOCKSProxyAddress: "[::1]:1080", SOCKSProxyHosts: "thinkingmachines.ai"},
		{SOCKSProxyAddress: "proxy:1080", SOCKSProxyHosts: "xn--bcher-kva.de"},
	} {
		if err := c.Validate(); err != nil {
			t.Fatal(err)
		}
		f, err := NewFetcherWithConfig(c)
		if err != nil {
			t.Fatal(err)
		}
		f.Close()
		if c.SOCKSProxyAddress == "" && (f.socksDial != nil || len(f.socksHosts) != 0) {
			t.Fatal("empty configuration enabled a proxy")
		}
	}
	valid := FetcherConfig{SOCKSProxyAddress: "172.30.0.1:11080", SOCKSProxyHosts: "thinkingmachines.ai"}
	var invalid []FetcherConfig
	for _, address := range []string{
		"", " ", "172.30.0.1", ":1080", "proxy:", "proxy:0", "proxy:65536", "proxy:http", "proxy:+1080", "proxy:01080",
		"socks5://proxy:1080", "user:secret@proxy:1080", "proxy:1080/path", "proxy:1080\n", "*.example.com:1080", ".example.com:1080",
		"proxy..example.com:1080", "127.1:1080", "0x7f000001:1080", "0.0.0.0:1080", "[::]:1080", "[ff02::1]:1080", "::1:1080", "[fe80::1%eth0]:1080", "[proxy]:1080", "[127.0.0.1]:1080",
	} {
		c := valid
		c.SOCKSProxyAddress = address
		invalid = append(invalid, c)
	}
	for _, hosts := range []string{
		"", " ", "*", "*.thinkingmachines.ai", ".thinkingmachines.ai", "com", "thinkingmachines.ai,", ",thinkingmachines.ai", "thinkingmachines.ai,,other.example.com",
		"thinkingmachines.ai,THINKINGMACHINES.AI", "https://thinkingmachines.ai", "thinkingmachines.ai:443", "thinkingmachines.ai/path", "user:secret@thinkingmachines.ai",
		"thinkingmachines.ai?query", "thinkingmachines.ai#fragment", "thinkingmachines.ai.", "127.0.0.1", "93.184.216.34", "2606:4700:4700::1111", "[2606:4700:4700::1111]",
		"localhost", "printer.local", "host.internal", "example.test", "home.arpa", "host.home.arpa", "service.onion", "service.alt", "127.1", "host.0x01", "a..example.com", "-a.example.com", "a_.example.com",
		strings.Repeat("a", 64) + ".com", strings.Repeat(strings.Repeat("a", 62)+".", 4) + "com", "BÜCHER.de",
	} {
		c := valid
		c.SOCKSProxyHosts = hosts
		invalid = append(invalid, c)
	}
	for i, c := range invalid {
		t.Run(strconv.Itoa(i), func(t *testing.T) {
			if err := c.Validate(); err == nil {
				t.Fatal("invalid configuration passed validation")
			} else if strings.Contains(err.Error(), "secret") {
				t.Fatal("configuration error leaked credentials")
			}
			if f, err := NewFetcherWithConfig(c); err == nil || f != nil {
				t.Fatal("invalid configuration constructed a fetcher")
			}
		})
	}
}

func TestFetcherSOCKSExactHostRouting(t *testing.T) {
	for _, tc := range []struct {
		host  string
		proxy bool
	}{
		{"thinkingmachines.ai", true},
		{"THINKINGMACHINES.AI.", true},
		{"www.thinkingmachines.ai", true},
		{"api.thinkingmachines.ai", false},
		{"thinkingmachines.ai.attacker.com", false},
		{"fakethinkingmachines.ai", false},
		{"other.example.com", false},
		{"93.184.216.34", false},
	} {
		t.Run(tc.host, func(t *testing.T) {
			f, err := NewFetcherWithConfig(FetcherConfig{SOCKSProxyAddress: "172.30.0.1:11080", SOCKSProxyHosts: "thinkingmachines.ai, www.thinkingmachines.ai"})
			if err != nil {
				t.Fatal(err)
			}
			defer f.Close()
			f.resolve = func(context.Context, string) ([]netip.Addr, error) {
				return []netip.Addr{netip.MustParseAddr("93.184.216.34"), netip.MustParseAddr("1.1.1.1")}, nil
			}
			var direct, proxied []string
			directErr, proxyErr := errors.New("direct failed"), errors.New("proxy failed")
			f.dial = func(_ context.Context, _, address string) (net.Conn, error) {
				direct = append(direct, address)
				return nil, directErr
			}
			f.socksDial = func(_ context.Context, _, address string) (net.Conn, error) {
				proxied = append(proxied, address)
				return nil, proxyErr
			}
			_, err = f.dialPublic(context.Background(), "tcp", net.JoinHostPort(tc.host, "443"))
			if tc.proxy {
				if !errors.Is(err, proxyErr) || len(proxied) != 2 || len(direct) != 0 {
					t.Fatalf("proxy routing/fallback: direct=%v proxy=%v err=%v", direct, proxied, err)
				}
			} else if !errors.Is(err, directErr) || len(direct) != 2 || len(proxied) != 0 {
				t.Fatalf("direct routing: direct=%v proxy=%v err=%v", direct, proxied, err)
			}
		})
	}
}

func TestFetcherSOCKSRejectsUnsafeDNSBeforeDial(t *testing.T) {
	for _, unsafe := range []string{"127.0.0.1", "10.1.2.3", "172.30.0.1", "169.254.169.254", "100.100.100.200", "192.0.2.1", "::1", "::ffff:192.168.1.1", "2001:db8::1", "64:ff9b::7f00:1", "fc00::1", "ff02::1"} {
		for _, mixed := range []bool{false, true} {
			t.Run(fmt.Sprintf("%s/mixed=%v", unsafe, mixed), func(t *testing.T) {
				f, err := NewFetcherWithConfig(FetcherConfig{SOCKSProxyAddress: "172.30.0.1:11080", SOCKSProxyHosts: "thinkingmachines.ai"})
				if err != nil {
					t.Fatal(err)
				}
				defer f.Close()
				ips := []netip.Addr{netip.MustParseAddr(unsafe)}
				if mixed {
					ips = append([]netip.Addr{netip.MustParseAddr("93.184.216.34")}, ips...)
				}
				f.resolve = func(context.Context, string) ([]netip.Addr, error) { return ips, nil }
				dials := 0
				for _, dial := range []*func(context.Context, string, string) (net.Conn, error){&f.dial, &f.socksDial} {
					*dial = func(context.Context, string, string) (net.Conn, error) {
						dials++
						return nil, errors.New("unexpected dial")
					}
				}
				if _, err := f.dialPublic(context.Background(), "tcp", "thinkingmachines.ai:443"); err == nil || dials != 0 {
					t.Fatalf("unsafe DNS reached a dialer: dials=%d err=%v", dials, err)
				}
			})
		}
	}
}

func TestFetcherSOCKSRedirectRoutingAndValidation(t *testing.T) {
	for _, tc := range []struct {
		name, start, target string
		wantRoutes          string
		wantErr             bool
	}{
		{"proxy to direct", "thinkingmachines.ai", "http://other.example.com/", "proxy,direct", false},
		{"direct to proxy", "other.example.com", "http://thinkingmachines.ai/", "direct,proxy", false},
		{"subdomain stays direct", "thinkingmachines.ai", "http://api.thinkingmachines.ai/", "proxy,direct", false},
		{"private DNS", "thinkingmachines.ai", "http://private.example.com/", "proxy", true},
		{"private literal", "thinkingmachines.ai", "http://127.0.0.1/", "proxy", true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			// An invalid environment proxy would make these fetches fail if the
			// transport accidentally enabled ProxyFromEnvironment.
			for _, key := range []string{"HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY"} {
				t.Setenv(key, "http://127.0.0.1:1")
			}
			t.Setenv("NO_PROXY", "")
			f, err := NewFetcherWithConfig(FetcherConfig{SOCKSProxyAddress: "172.30.0.1:11080", SOCKSProxyHosts: "thinkingmachines.ai"})
			if err != nil {
				t.Fatal(err)
			}
			defer f.Close()
			if f.client.Transport.(*http.Transport).Proxy != nil {
				t.Fatal("HTTP proxy support was enabled")
			}
			f.resolve = func(_ context.Context, host string) ([]netip.Addr, error) {
				ips := []netip.Addr{netip.MustParseAddr("93.184.216.34")}
				if host == "private.example.com" {
					ips = append(ips, netip.MustParseAddr("127.0.0.1"))
				}
				return ips, nil
			}
			var routes []string
			dial := func(route string) func(context.Context, string, string) (net.Conn, error) {
				return func(_ context.Context, _, address string) (net.Conn, error) {
					routes = append(routes, route)
					if address != "93.184.216.34:80" {
						t.Errorf("destination was not pinned: %s", address)
					}
					client, server := net.Pipe()
					go func() {
						defer server.Close()
						server.SetDeadline(time.Now().Add(2 * time.Second))
						req, err := http.ReadRequest(bufio.NewReader(server))
						if err != nil {
							return
						}
						defer req.Body.Close()
						if req.Host == tc.start {
							fmt.Fprintf(server, "HTTP/1.1 302 Found\r\nLocation: %s\r\nContent-Length: 0\r\nConnection: close\r\n\r\n", tc.target)
						} else {
							io.WriteString(server, "HTTP/1.1 200 OK\r\nContent-Length: 2\r\nConnection: close\r\n\r\nok")
						}
					}()
					return client, nil
				}
			}
			f.dial, f.socksDial = dial("direct"), dial("proxy")
			res, err := f.Get(context.Background(), "http://"+tc.start+"/", 100)
			if (err != nil) != tc.wantErr || strings.Join(routes, ",") != tc.wantRoutes {
				t.Fatalf("redirect: routes=%v result=%+v err=%v", routes, res, err)
			}
		})
	}
}

// Each test proxy accepts one connection and never forwards traffic externally.
func startTestSOCKSProxy(t *testing.T, handle func(net.Conn)) string {
	t.Helper()
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	accepted := make(chan net.Conn, 1)
	done := make(chan struct{})
	go func() {
		defer close(done)
		conn, err := listener.Accept()
		if err != nil {
			return
		}
		defer conn.Close()
		accepted <- conn
		conn.SetDeadline(time.Now().Add(10 * time.Second))
		handle(conn)
	}()
	t.Cleanup(func() {
		listener.Close()
		select {
		case conn := <-accepted:
			conn.Close()
		case <-done:
		}
		<-done
	})
	return listener.Addr().String()
}

func readTestSOCKSDestination(conn net.Conn) (string, error) {
	var greeting [3]byte
	if _, err := io.ReadFull(conn, greeting[:]); err != nil {
		return "", err
	}
	if greeting != [3]byte{5, 1, 0} {
		return "", fmt.Errorf("unexpected SOCKS greeting: %v", greeting)
	}
	if _, err := conn.Write([]byte{5, 0}); err != nil {
		return "", err
	}
	var header [4]byte
	if _, err := io.ReadFull(conn, header[:]); err != nil {
		return "", err
	}
	if header[0] != 5 || header[1] != 1 || header[2] != 0 {
		return "", fmt.Errorf("unexpected SOCKS command: %v", header)
	}
	var size int
	switch header[3] {
	case 1:
		size = 4
	case 4:
		size = 16
	default:
		return "", errors.New("SOCKS received a hostname instead of a pinned IP")
	}
	b := make([]byte, size+2)
	if _, err := io.ReadFull(conn, b); err != nil {
		return "", err
	}
	ip, _ := netip.AddrFromSlice(b[:size])
	return net.JoinHostPort(ip.String(), strconv.Itoa(int(binary.BigEndian.Uint16(b[size:])))), nil
}

func replyTestSOCKS(conn net.Conn, status byte) error {
	_, err := conn.Write([]byte{5, status, 0, 1, 127, 0, 0, 1, 0, 0})
	return err
}

func TestFetcherSOCKSPinsValidatedIPAndPort(t *testing.T) {
	for _, tc := range []struct {
		ip, port, want string
	}{
		{"93.184.216.34", "443", "93.184.216.34:443"},
		{"::ffff:93.184.216.34", "80", "93.184.216.34:80"},
		{"2606:4700:4700::1111", "443", "[2606:4700:4700::1111]:443"},
	} {
		t.Run(tc.want, func(t *testing.T) {
			destination := make(chan string, 1)
			address := startTestSOCKSProxy(t, func(conn net.Conn) {
				got, err := readTestSOCKSDestination(conn)
				if err != nil {
					t.Error(err)
					return
				}
				destination <- got
				if err := replyTestSOCKS(conn, 0); err != nil {
					t.Error(err)
				}
			})
			f, err := NewFetcherWithConfig(FetcherConfig{SOCKSProxyAddress: address, SOCKSProxyHosts: "thinkingmachines.ai"})
			if err != nil {
				t.Fatal(err)
			}
			defer f.Close()
			lookups := 0
			f.resolve = func(_ context.Context, host string) ([]netip.Addr, error) {
				lookups++
				if host != "thinkingmachines.ai" {
					t.Errorf("resolved %q", host)
				}
				if lookups > 1 {
					return []netip.Addr{netip.MustParseAddr("127.0.0.1")}, nil
				}
				return []netip.Addr{netip.MustParseAddr(tc.ip)}, nil
			}
			f.dial = func(context.Context, string, string) (net.Conn, error) {
				t.Error("proxy destination used a direct connection")
				return nil, errors.New("unexpected direct dial")
			}
			conn, err := f.dialPublic(context.Background(), "tcp", net.JoinHostPort("thinkingmachines.ai", tc.port))
			if err != nil {
				t.Fatal(err)
			}
			conn.Close()
			if got := <-destination; got != tc.want || lookups != 1 {
				t.Fatalf("destination=%s lookups=%d; want %s and one local lookup", got, lookups, tc.want)
			}
		})
	}
}

func TestFetcherSOCKSHandshakeCancellationAndTimeout(t *testing.T) {
	for _, mode := range []string{"cancel greeting", "cancel connect", "caller deadline", "dial timeout"} {
		t.Run(mode, func(t *testing.T) {
			entered := make(chan struct{})
			closed := make(chan struct{})
			address := startTestSOCKSProxy(t, func(conn net.Conn) {
				defer close(closed)
				if mode == "cancel greeting" {
					var greeting [3]byte
					if _, err := io.ReadFull(conn, greeting[:]); err != nil {
						t.Error(err)
						return
					}
				} else if _, err := readTestSOCKSDestination(conn); err != nil {
					t.Error(err)
					return
				}
				close(entered)
				io.Copy(io.Discard, conn) // No reply: the client must interrupt the handshake.
			})
			f, err := NewFetcherWithConfig(FetcherConfig{SOCKSProxyAddress: address, SOCKSProxyHosts: "thinkingmachines.ai"})
			if err != nil {
				t.Fatal(err)
			}
			defer f.Close()
			f.resolve = func(context.Context, string) ([]netip.Addr, error) {
				return []netip.Addr{netip.MustParseAddr("93.184.216.34")}, nil
			}
			timeout := 8 * time.Second
			if mode == "caller deadline" {
				timeout = 150 * time.Millisecond
			}
			ctx, cancel := context.WithTimeout(context.Background(), timeout)
			defer cancel()
			result := make(chan error, 1)
			go func() {
				conn, err := f.dialPublic(ctx, "tcp", "thinkingmachines.ai:443")
				if conn != nil {
					conn.Close()
				}
				result <- err
			}()
			select {
			case <-entered:
			case err := <-result:
				t.Fatalf("dial ended before entering the handshake: %v", err)
			case <-time.After(time.Second):
				t.Fatal("proxy handshake did not start")
			}
			limit := time.Second
			if strings.HasPrefix(mode, "cancel") {
				cancel()
			} else if mode == "dial timeout" {
				limit = 6 * time.Second
			}
			select {
			case err := <-result:
				if err == nil {
					t.Fatal("stalled handshake succeeded")
				}
				if mode == "dial timeout" && ctx.Err() != nil {
					t.Fatal("proxy relied on the outer context instead of the five-second dial limit")
				}
			case <-time.After(limit):
				t.Fatal("SOCKS handshake ignored cancellation or timeout")
			}
			select {
			case <-closed:
			case <-time.After(time.Second):
				t.Fatal("interrupted handshake left the proxy socket open")
			}
		})
	}
}

func TestFetcherSOCKSPreservesTLSHostnameVerification(t *testing.T) {
	for _, certHost := range []string{"thinkingmachines.ai", "wrong.example.com"} {
		t.Run(certHost, func(t *testing.T) {
			key, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
			if err != nil {
				t.Fatal(err)
			}
			template := &x509.Certificate{SerialNumber: big.NewInt(1), Subject: pkix.Name{CommonName: certHost}, DNSNames: []string{certHost}, NotBefore: time.Now().Add(-time.Hour), NotAfter: time.Now().Add(time.Hour), KeyUsage: x509.KeyUsageDigitalSignature, ExtKeyUsage: []x509.ExtKeyUsage{x509.ExtKeyUsageServerAuth}}
			der, err := x509.CreateCertificate(rand.Reader, template, template, &key.PublicKey, key)
			if err != nil {
				t.Fatal(err)
			}
			cert, err := x509.ParseCertificate(der)
			if err != nil {
				t.Fatal(err)
			}
			sni := make(chan string, 1)
			address := startTestSOCKSProxy(t, func(conn net.Conn) {
				if _, err := readTestSOCKSDestination(conn); err != nil {
					t.Error(err)
					return
				}
				if err := replyTestSOCKS(conn, 0); err != nil {
					t.Error(err)
					return
				}
				tlsConn := tls.Server(conn, &tls.Config{Certificates: []tls.Certificate{{Certificate: [][]byte{der}, PrivateKey: key}}, GetConfigForClient: func(hello *tls.ClientHelloInfo) (*tls.Config, error) {
					sni <- hello.ServerName
					return nil, nil
				}})
				defer tlsConn.Close()
				if err := tlsConn.Handshake(); err != nil {
					if certHost == "thinkingmachines.ai" {
						t.Error(err)
					}
					return
				}
				req, err := http.ReadRequest(bufio.NewReader(tlsConn))
				if err != nil {
					t.Error(err)
					return
				}
				defer req.Body.Close()
				if req.Host != "thinkingmachines.ai" {
					t.Errorf("HTTP Host changed to %q", req.Host)
				}
				io.WriteString(tlsConn, "HTTP/1.1 200 OK\r\nContent-Length: 2\r\nConnection: close\r\n\r\nok")
			})
			f, err := NewFetcherWithConfig(FetcherConfig{SOCKSProxyAddress: address, SOCKSProxyHosts: "thinkingmachines.ai"})
			if err != nil {
				t.Fatal(err)
			}
			defer f.Close()
			f.resolve = func(context.Context, string) ([]netip.Addr, error) {
				return []netip.Addr{netip.MustParseAddr("93.184.216.34")}, nil
			}
			roots := x509.NewCertPool()
			roots.AddCert(cert)
			f.client.Transport.(*http.Transport).TLSClientConfig = &tls.Config{RootCAs: roots}
			res, err := f.Get(context.Background(), "https://thinkingmachines.ai/rss.xml", 100)
			if certHost == "thinkingmachines.ai" {
				if err != nil || string(res.Body) != "ok" || res.URL != "https://thinkingmachines.ai/rss.xml" {
					t.Fatalf("TLS fetch: %+v, %v", res, err)
				}
			} else {
				var hostnameErr x509.HostnameError
				if !errors.As(err, &hostnameErr) {
					t.Fatalf("expected certificate hostname verification failure, got %v", err)
				}
			}
			select {
			case got := <-sni:
				if got != "thinkingmachines.ai" {
					t.Fatalf("TLS SNI changed to %q", got)
				}
			case <-time.After(time.Second):
				t.Fatal("TLS client did not send SNI")
			}
		})
	}
}
