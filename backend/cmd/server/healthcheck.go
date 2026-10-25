package main

import (
	"context"
	"errors"
	"net/http"
	"time"
)

const healthcheckTimeout = 3 * time.Second

func checkHealth(ctx context.Context, port string) error {
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, "http://127.0.0.1:"+port+"/api/health", nil)
	if err != nil {
		return errors.New("healthcheck request failed")
	}
	client := &http.Client{
		Timeout:   healthcheckTimeout,
		Transport: &http.Transport{DisableKeepAlives: true},
		CheckRedirect: func(*http.Request, []*http.Request) error {
			return http.ErrUseLastResponse
		},
	}
	response, err := client.Do(request)
	if err != nil {
		return errors.New("healthcheck request failed")
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return errors.New("healthcheck returned an unhealthy status")
	}
	return nil
}
