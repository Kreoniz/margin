package app

import "testing"

func ptr[T any](v T) *T { return &v }
func TestMediaValidationAndCompletion(t *testing.T) {
	base := NewMedia()
	base.Title = "A book"
	if base.Status != "pending" || base.Visibility != "private" {
		t.Fatal(base)
	}
	for _, in := range []MediaInput{{Kind: ptr("podcast")}, {Status: ptr("active")}, {Status: ptr("completed")}, {Visibility: ptr("shared")}, {URL: ptr("javascript:alert(1)")}, {CoverURL: ptr("http://127.0.0.1/a.jpg")}, {Title: ptr("")}} {
		if _, err := in.Apply(base); err == nil {
			t.Errorf("accepted invalid input %+v", in)
		}
	}
	m, err := (MediaInput{Status: ptr("done"), Tags: ptr([]string{" systems ", "Systems", "", "books"})}).Apply(base)
	if err != nil || m.CompletedAt == nil || len(m.Tags) != 2 {
		t.Fatalf("completion %+v %v", m, err)
	}
	stamp := *m.CompletedAt
	m, err = (MediaInput{Notes: ptr("remember this")}).Apply(m)
	if err != nil || !m.CompletedAt.Equal(stamp) {
		t.Fatal("completion date changed")
	}
	m, err = (MediaInput{Status: ptr("pending")}).Apply(m)
	if err != nil || m.CompletedAt != nil || m.Status != "pending" {
		t.Fatalf("reopen %+v %v", m, err)
	}
}
func TestManualKey(t *testing.T) {
	a := Media{Title: "  CAFÉ   Society ", Author: " Someone ", Kind: "book"}
	b := Media{Title: "cafe\u0301 society", Author: "someone", Kind: "book"}
	if manualKey(a) != manualKey(b) {
		t.Fatal("Unicode/whitespace normalization differs")
	}
	b.Kind = "movie"
	if manualKey(a) == manualKey(b) {
		t.Fatal("kind missing from duplicate key")
	}
}
