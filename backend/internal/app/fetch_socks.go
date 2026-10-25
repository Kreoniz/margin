package app

import (
	"context"
	"errors"
	"net"
	"net/netip"
	"strconv"
	"strings"
	"time"

	"golang.org/x/net/proxy"
)

// FetcherConfig optionally routes only the comma-separated exact public DNS
// names in SOCKSProxyHosts through the trusted SOCKS5 SOCKSProxyAddress (host:port).
// Both fields must be empty to disable the proxy. Credentials and URLs are not
// accepted; the proxy endpoint itself may be on a private network.
type FetcherConfig struct {
	SOCKSProxyAddress string
	SOCKSProxyHosts   string
}

// Validate checks configuration without connecting to the proxy or resolving DNS.
func (c FetcherConfig) Validate() error {
	_, err := c.socksHosts()
	return err
}

func (c FetcherConfig) socksHosts() (map[string]struct{}, error) {
	if c.SOCKSProxyAddress == "" && c.SOCKSProxyHosts == "" {
		return nil, nil
	}
	if c.SOCKSProxyAddress == "" || c.SOCKSProxyHosts == "" {
		return nil, errors.New("SOCKS_PROXY_ADDRESS and SOCKS_PROXY_HOSTS must both be set or both be empty")
	}
	host, port, err := net.SplitHostPort(c.SOCKSProxyAddress)
	n, portErr := strconv.ParseUint(port, 10, 16)
	if err != nil || portErr != nil || n == 0 || strconv.FormatUint(n, 10) != port || net.JoinHostPort(host, port) != c.SOCKSProxyAddress || !validSOCKSEndpointHost(host) {
		return nil, errors.New("SOCKS_PROXY_ADDRESS must be a host:port without credentials, a URL scheme, or a scoped address")
	}
	hosts := make(map[string]struct{})
	for _, entry := range strings.Split(c.SOCKSProxyHosts, ",") {
		host := strings.ToLower(strings.TrimSpace(entry))
		canonical, err := CanonicalURL("https://" + host + "/")
		_, ipErr := netip.ParseAddr(host)
		if !validSOCKSEndpointHost(host) || err != nil || canonical != "https://"+host+"/" || ipErr == nil || host == "home.arpa" || strings.HasSuffix(host, ".onion") || strings.HasSuffix(host, ".alt") {
			return nil, errors.New("SOCKS_PROXY_HOSTS must contain only exact public ASCII DNS names without ports, trailing dots, or empty entries")
		}
		if _, exists := hosts[host]; exists {
			return nil, errors.New("SOCKS_PROXY_HOSTS must not contain duplicate hostnames")
		}
		hosts[host] = struct{}{}
	}
	return hosts, nil
}

func validSOCKSEndpointHost(host string) bool {
	if ip, err := netip.ParseAddr(host); err == nil {
		return ip.Zone() == "" && !ip.IsUnspecified() && !ip.IsMulticast()
	}
	if host == "" || len(host) > 253 {
		return false
	}
	labels := strings.Split(strings.ToLower(host), ".")
	last := labels[len(labels)-1]
	if strings.Trim(last, "0123456789") == "" || strings.HasPrefix(last, "0x") {
		return false
	}
	for _, label := range labels {
		if label == "" || len(label) > 63 || label[0] == '-' || label[len(label)-1] == '-' {
			return false
		}
		for _, c := range label {
			if !(c >= 'a' && c <= 'z' || c >= '0' && c <= '9' || c == '-') {
				return false
			}
		}
	}
	return true
}

// NewFetcherWithConfig preserves NewFetcher behavior when configuration is empty.
// Matching hosts still resolve locally and pass the same public-IP checks before
// SOCKS receives an IP literal. Proxy errors never fall back to direct egress.
func NewFetcherWithConfig(c FetcherConfig) (*Fetcher, error) {
	hosts, err := c.socksHosts()
	if err != nil {
		return nil, err
	}
	f := NewFetcher()
	if len(hosts) == 0 {
		return f, nil
	}
	d, err := proxy.SOCKS5("tcp", c.SOCKSProxyAddress, nil, &net.Dialer{Timeout: fetchDialTimeout, KeepAlive: 30 * time.Second})
	if err != nil {
		return nil, errors.New("cannot configure SOCKS5 proxy")
	}
	contextDialer, ok := d.(proxy.ContextDialer)
	if !ok {
		return nil, errors.New("SOCKS5 proxy must support context cancellation")
	}
	f.socksHosts = hosts
	f.socksDial = func(ctx context.Context, network, address string) (net.Conn, error) {
		// net.Dialer.Timeout covers reaching the proxy, but not the SOCKS
		// handshake. Bound both, while honoring any shorter caller deadline.
		ctx, cancel := context.WithTimeout(ctx, fetchDialTimeout)
		defer cancel()
		return contextDialer.DialContext(ctx, network, address)
	}
	return f, nil
}
