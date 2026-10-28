package main

import (
	"net/netip"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"

	"margin/internal/app"
)

func writeSecretFile(t *testing.T, contents string) string {
	t.Helper()
	path := filepath.Join(t.TempDir(), "secret")
	if err := os.WriteFile(path, []byte(contents), 0600); err != nil {
		t.Fatal(err)
	}
	return path
}

func TestSecretValue(t *testing.T) {
	for _, name := range []string{"DATABASE_URL", "APP_PASSWORD"} {
		t.Run(name, func(t *testing.T) {
			for _, tc := range []struct {
				name     string
				value    string
				file     bool
				contents string
				want     string
			}{
				{name: "unset"},
				{name: "environment unchanged", value: "  environment-secret\n", want: "  environment-secret\n"},
				{name: "file without newline", file: true, contents: "file-secret", want: "file-secret"},
				{name: "LF preserves spaces", file: true, contents: "  file-secret \n", want: "  file-secret "},
				{name: "CRLF", file: true, contents: "file-secret\r\n", want: "file-secret"},
				{name: "empty file", file: true},
				{name: "only newlines", file: true, contents: "\r\n\n"},
				{name: "size boundary", file: true, contents: strings.Repeat("s", maxSecretFileSize), want: strings.Repeat("s", maxSecretFileSize)},
			} {
				t.Run(tc.name, func(t *testing.T) {
					t.Setenv(name, tc.value)
					t.Setenv(name+"_FILE", "")
					if tc.file {
						t.Setenv(name+"_FILE", writeSecretFile(t, tc.contents))
					}
					got, err := secretValue(name)
					if err != nil {
						t.Fatal(err)
					}
					if got != tc.want {
						t.Fatal("secret value was changed unexpectedly")
					}
				})
			}
		})
	}
}

func TestSecretValueErrorsAreGeneric(t *testing.T) {
	for _, name := range []string{"DATABASE_URL", "APP_PASSWORD"} {
		t.Run(name, func(t *testing.T) {
			for _, kind := range []string{"ambiguous", "missing", "directory", "oversized"} {
				t.Run(kind, func(t *testing.T) {
					t.Setenv(name, "")
					path := filepath.Join(t.TempDir(), "private-path")
					want := "cannot read " + name + "_FILE"
					switch kind {
					case "ambiguous":
						t.Setenv(name, "private-environment-secret")
						want = name + " and " + name + "_FILE cannot both be set"
					case "directory":
						path = t.TempDir()
					case "oversized":
						path = writeSecretFile(t, strings.Repeat("s", maxSecretFileSize+1))
						want = name + "_FILE exceeds size limit"
					}
					t.Setenv(name+"_FILE", path)
					got, err := secretValue(name)
					if got != "" || err == nil || err.Error() != want {
						t.Fatalf("expected empty value and generic error %q; got error %v", want, err)
					}
				})
			}
		})
	}
}

func TestLoadConfig(t *testing.T) {
	for _, tc := range []struct {
		name    string
		env     map[string]string
		files   map[string]string
		want    config
		wantErr string
	}{
		{name: "defaults", env: map[string]string{"DATABASE_URL": "database-secret"}, want: config{databaseURL: "database-secret", port: "8080", staticDir: "../web/dist"}},
		{name: "development opt-in", env: map[string]string{"DATABASE_URL": "database-secret", "MARGIN_DEV_MODE": "1"}, want: config{databaseURL: "database-secret", port: "8080", staticDir: "../web/dist", devMode: true}},
		{name: "trusted proxy", env: map[string]string{"DATABASE_URL": "database-secret", "TRUSTED_PROXIES": "192.0.2.4/32"}, want: config{databaseURL: "database-secret", port: "8080", staticDir: "../web/dist", trustedProxies: []netip.Prefix{netip.MustParsePrefix("192.0.2.4/32")}}},
		{name: "reject broad proxy trust", env: map[string]string{"DATABASE_URL": "database-secret", "TRUSTED_PROXIES": "192.0.2.0/24"}, wantErr: "invalid trusted proxy configuration: expected exact IP prefixes (/32 or /128)"},
		{name: "SOCKS egress", env: map[string]string{"DATABASE_URL": "database-secret", "SOCKS_PROXY_ADDRESS": "172.30.0.1:11080", "SOCKS_PROXY_HOSTS": "thinkingmachines.ai"}, want: config{databaseURL: "database-secret", port: "8080", staticDir: "../web/dist", fetcher: app.FetcherConfig{SOCKSProxyAddress: "172.30.0.1:11080", SOCKSProxyHosts: "thinkingmachines.ai"}}},
		{name: "SOCKS address without hosts", env: map[string]string{"DATABASE_URL": "database-secret", "SOCKS_PROXY_ADDRESS": "172.30.0.1:11080"}, wantErr: "SOCKS_PROXY_ADDRESS and SOCKS_PROXY_HOSTS must both be set or both be empty"},
		{name: "SOCKS hosts without address", env: map[string]string{"DATABASE_URL": "database-secret", "SOCKS_PROXY_HOSTS": "thinkingmachines.ai"}, wantErr: "SOCKS_PROXY_ADDRESS and SOCKS_PROXY_HOSTS must both be set or both be empty"},
		{name: "SOCKS wildcard", env: map[string]string{"DATABASE_URL": "database-secret", "SOCKS_PROXY_ADDRESS": "172.30.0.1:11080", "SOCKS_PROXY_HOSTS": "*.thinkingmachines.ai"}, wantErr: "SOCKS_PROXY_HOSTS must contain only exact public ASCII DNS names without ports, trailing dots, or empty entries"},
		{name: "environment", env: map[string]string{"DATABASE_URL": "database-secret\n", "APP_PASSWORD": "  password-secret\n", "PORT": "9090", "STATIC_DIR": "/web"}, want: config{databaseURL: "database-secret\n", password: "  password-secret\n", port: "9090", staticDir: "/web"}},
		{name: "files", files: map[string]string{"DATABASE_URL": "database-secret\n", "APP_PASSWORD": "  password-secret \r\n"}, want: config{databaseURL: "database-secret", password: "  password-secret ", port: "8080", staticDir: "../web/dist"}},
		{name: "missing database", wantErr: "DATABASE_URL is required"},
		{name: "empty database file", files: map[string]string{"DATABASE_URL": "\r\n"}, wantErr: "DATABASE_URL is required"},
		{name: "empty optional password file", env: map[string]string{"DATABASE_URL": "database-secret"}, files: map[string]string{"APP_PASSWORD": "\n"}, want: config{databaseURL: "database-secret", port: "8080", staticDir: "../web/dist"}},
		{name: "invalid environment password", env: map[string]string{"DATABASE_URL": "database-secret", "APP_PASSWORD": "short"}, wantErr: "APP_PASSWORD: password must contain at least 12 characters and at most 1024 bytes"},
		{name: "invalid file password", env: map[string]string{"DATABASE_URL": "database-secret"}, files: map[string]string{"APP_PASSWORD": "short\n"}, wantErr: "APP_PASSWORD: password must contain at least 12 characters and at most 1024 bytes"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			for _, name := range []string{"MARGIN_DEV_MODE", "DATABASE_URL", "DATABASE_URL_FILE", "APP_PASSWORD", "APP_PASSWORD_FILE", "PORT", "STATIC_DIR", "TRUSTED_PROXIES", "SOCKS_PROXY_ADDRESS", "SOCKS_PROXY_HOSTS"} {
				t.Setenv(name, "")
			}
			for name, value := range tc.env {
				t.Setenv(name, value)
			}
			for name, value := range tc.files {
				t.Setenv(name+"_FILE", writeSecretFile(t, value))
			}
			got, err := loadConfig()
			if tc.wantErr != "" {
				if err == nil || err.Error() != tc.wantErr {
					t.Fatalf("expected error %q; got %v", tc.wantErr, err)
				}
				return
			}
			if err != nil {
				t.Fatal(err)
			}
			if !reflect.DeepEqual(got, tc.want) {
				t.Fatal("configuration did not match expected values")
			}
		})
	}
}

func TestLoadPort(t *testing.T) {
	for _, port := range []string{"", "1", "8080", "65535", "0", "65536", "-1", "not-a-port"} {
		t.Run(port, func(t *testing.T) {
			t.Setenv("PORT", port)
			got, err := loadPort()
			switch port {
			case "":
				if got != "8080" || err != nil {
					t.Fatalf("default port: %q, %v", got, err)
				}
			case "1", "8080", "65535":
				if got != port || err != nil {
					t.Fatalf("valid port: %q, %v", got, err)
				}
			default:
				if err == nil || err.Error() != "PORT must be between 1 and 65535" {
					t.Fatalf("invalid port: %v", err)
				}
			}
		})
	}
}
