package app

import (
	"strings"
	"unicode/utf8"
)

const selectionNotSavedWarning = "Already saved. The selected text was not added. Open Margin to review the existing item."

type captureSelection struct {
	Text      string `json:"text"`
	SourceURL string `json:"source_url"`
}

func validateSelection(in *captureSelection, capturedURL string) (captureSelection, error) {
	if in == nil {
		return captureSelection{}, nil
	}
	if strings.TrimSpace(in.Text) == "" || len(in.Text) > 10000 || !utf8.ValidString(in.Text) {
		return captureSelection{}, &ValidationError{"Selected text must contain 1–10,000 UTF-8 bytes"}
	}
	source, err := CanonicalURL(in.SourceURL)
	if err != nil || source != capturedURL {
		return captureSelection{}, &ValidationError{"Selected text source must match the captured URL, including its fragment"}
	}
	return captureSelection{Text: in.Text, SourceURL: source}, nil
}
