package main

import (
	"errors"
	"fmt"
	"io"
	"net/netip"
	"os"
	"strconv"
	"strings"

	"margin/internal/app"
)

const maxSecretFileSize = 64 << 10

type config struct {
	devMode        bool
	databaseURL    string
	port           string
	password       string
	staticDir      string
	trustedProxies []netip.Prefix
	fetcher        app.FetcherConfig
}

func loadConfig() (config, error) {
	var c config
	c.devMode = os.Getenv("MARGIN_DEV_MODE") == "1"
	var err error
	c.databaseURL, err = secretValue("DATABASE_URL")
	if err != nil {
		return c, err
	}
	if c.databaseURL == "" {
		return c, errors.New("DATABASE_URL is required")
	}
	c.port, err = loadPort()
	if err != nil {
		return c, err
	}
	c.password, err = secretValue("APP_PASSWORD")
	if err != nil {
		return c, err
	}
	if c.password != "" {
		if err := app.ValidatePassword(c.password); err != nil {
			return c, fmt.Errorf("APP_PASSWORD: %w", err)
		}
	}
	c.staticDir = os.Getenv("STATIC_DIR")
	if c.staticDir == "" {
		c.staticDir = "../web/dist"
	}
	c.trustedProxies, err = app.ParseTrustedProxies(os.Getenv("TRUSTED_PROXIES"))
	if err != nil {
		return c, err
	}
	c.fetcher = app.FetcherConfig{SOCKSProxyAddress: os.Getenv("SOCKS_PROXY_ADDRESS"), SOCKSProxyHosts: os.Getenv("SOCKS_PROXY_HOSTS")}
	if err := c.fetcher.Validate(); err != nil {
		return c, err
	}
	return c, nil
}

func loadPort() (string, error) {
	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}
	if n, err := strconv.Atoi(port); err != nil || n < 1 || n > 65535 {
		return "", errors.New("PORT must be between 1 and 65535")
	}
	return port, nil
}

func secretValue(name string) (string, error) {
	value, path := os.Getenv(name), os.Getenv(name+"_FILE")
	if path == "" {
		return value, nil
	}
	if value != "" {
		return "", fmt.Errorf("%s and %s_FILE cannot both be set", name, name)
	}
	file, err := os.Open(path)
	if err != nil {
		return "", fmt.Errorf("cannot read %s_FILE", name)
	}
	defer file.Close()
	data, err := io.ReadAll(io.LimitReader(file, maxSecretFileSize+1))
	if err != nil {
		return "", fmt.Errorf("cannot read %s_FILE", name)
	}
	if len(data) > maxSecretFileSize {
		return "", fmt.Errorf("%s_FILE exceeds size limit", name)
	}
	return strings.TrimRight(string(data), "\r\n"), nil
}
