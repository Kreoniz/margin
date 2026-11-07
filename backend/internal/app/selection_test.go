package app

import (
	"context"
	"encoding/json"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestSelectionValidationAndPublicDTO(t *testing.T) {
	url := "https://source.example/page#paragraph"
	for _, selection := range []*captureSelection{
		{Text: "", SourceURL: url}, {Text: "  ", SourceURL: url},
		{Text: strings.Repeat("я", 5001), SourceURL: url},
		{Text: "text", SourceURL: "https://other.example/page#paragraph"},
		{Text: "text", SourceURL: "https://source.example/page#other"},
		{Text: "text", SourceURL: "file:///private"},
	} {
		if _, err := validateSelection(selection, url); err == nil {
			t.Fatalf("selection accepted: %+v", selection)
		}
	}
	selected, err := validateSelection(&captureSelection{Text: strings.Repeat("я", 5000), SourceURL: url}, url)
	if err != nil || len(selected.Text) != 10000 || selected.SourceURL != url {
		t.Fatalf("boundary rejected: %+v %v", selected, err)
	}
	m := NewMedia()
	m.Title = "Public"
	m.SelectedText = "PRIVATE_EXCERPT"
	m.SelectedTextSourceURL = "PRIVATE_SOURCE"
	m.Notes = "PRIVATE_NOTE"
	raw, _ := json.Marshal(publicMedia(m))
	for _, term := range []string{"PRIVATE", "selected_text", "notes", "metadata_state", "needs_review", "token", "count"} {
		if strings.Contains(string(raw), term) {
			t.Fatalf("public leak: %s", raw)
		}
	}
}

func TestCaptureSelectionPersistenceDuplicatesAndPrivacy(t *testing.T) {
	s := integrationStore(t)
	owner, _ := ownerClient(t, s)
	token := responseMap(t, owner.request("POST", "/api/integration/browser-token", ""))["token"].(string)
	capture := func(body string) *httptest.ResponseRecorder {
		r := httptest.NewRequest("POST", "/api/integrations/capture", strings.NewReader(body))
		r.Header.Set("Authorization", "Bearer "+token)
		r.Header.Set("Origin", "chrome-extension://fixture")
		w := httptest.NewRecorder()
		owner.handler.ServeHTTP(w, r)
		return w
	}
	w := capture(`{"url":"https://source.example/page#paragraph","action":"save","selection":{"text":"PRIVATE_EXCERPT","source_url":"https://source.example/page#paragraph"}}`)
	requireCode(t, w, 201)
	receipt := responseMap(t, w)
	id := receipt["id"].(string)
	if receipt["selection_saved"] != true || strings.Contains(w.Body.String(), "PRIVATE_EXCERPT") {
		t.Fatal(w.Body)
	}
	m := submissionMedia(t, s, id)
	if m.SelectedText != "PRIVATE_EXCERPT" || m.SelectedTextSourceURL != m.URL || m.Notes != "" {
		t.Fatalf("selection not distinct: %+v", m)
	}
	requireCode(t, owner.request("PATCH", "/api/media/"+id, `{"notes":"Original note","visibility":"public","needs_review":false}`), 200)
	w = capture(`{"url":"https://source.example/page#another","action":"save","selection":{"text":"SECOND_EXCERPT","source_url":"https://source.example/page#another"}}`)
	requireCode(t, w, 200)
	duplicate := responseMap(t, w)
	if duplicate["selection_saved"] != false || duplicate["warning"] != selectionNotSavedWarning || duplicate["id"] != id || duplicate["metadata_state"] != nil {
		t.Fatal(duplicate)
	}
	for _, term := range []string{"PRIVATE_EXCERPT", "Original note", "selected_text_source_url", "SECOND_EXCERPT"} {
		if strings.Contains(w.Body.String(), term) {
			t.Fatalf("duplicate leaked %s", w.Body)
		}
	}
	m = submissionMedia(t, s, id)
	if m.SelectedText != "PRIVATE_EXCERPT" || m.SelectedTextSourceURL != "https://source.example/page#paragraph" || m.Notes != "Original note" || m.NeedsReview {
		t.Fatalf("duplicate changed private data: %+v", m)
	}
	// The selected source remains the original page even after owner URL edits.
	requireCode(t, owner.request("PATCH", "/api/media/"+id, `{"url":"https://new-source.example/different"}`), 200)
	if got := submissionMedia(t, s, id); got.SelectedTextSourceURL != m.SelectedTextSourceURL || got.SelectedText != m.SelectedText {
		t.Fatal("excerpt rebound on URL edit")
	}
	for _, path := range []string{"/api/public/media", "/api/public/media/" + id} {
		public := owner.request("GET", path, "")
		requireCode(t, public, 200)
		for _, term := range []string{"selected_text", "PRIVATE_EXCERPT", "Original note", "needs_review", "metadata_state", "agent_grants"} {
			if strings.Contains(public.Body.String(), term) {
				t.Fatalf("public leak: %s", public.Body)
			}
		}
	}
	// Selection is not accepted through ordinary create/PATCH or submission APIs.
	requireCode(t, owner.request("PATCH", "/api/media/"+id, `{"selected_text":"replace"}`), 400)
	bad := capture(`{"url":"https://source.example/invalid","action":"save","selection":{"text":"text","source_url":"https://other.example/"}}`)
	requireCode(t, bad, 400)
	var count int
	if err := s.Pool.QueryRow(context.Background(), "SELECT count(*) FROM media WHERE url='https://source.example/invalid'").Scan(&count); err != nil || count != 0 {
		t.Fatalf("invalid selection persisted: %d %v", count, err)
	}
	ordinary := capture(`{"url":"https://source.example/ordinary","action":"save"}`)
	requireCode(t, ordinary, 201)
	if _, present := responseMap(t, ordinary)["selection_saved"]; present {
		t.Fatal("ordinary receipt changed")
	}
}
