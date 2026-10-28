package app

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"regexp"
	"strings"
	"sync"
	"time"

	"golang.org/x/net/html"
)

var isbnPattern = regexp.MustCompile(`(?i)(?:97[89][- ]?)?[0-9][- 0-9]{8,15}[0-9X]`)
var editionKey = regexp.MustCompile(`^/books/OL[0-9]+M$`)
var workKey = regexp.MustCompile(`^/works/OL[0-9]+W$`)

func validISBN(raw string) string {
	s := strings.NewReplacer("-", "", " ", "").Replace(strings.ToUpper(strings.TrimSpace(raw)))
	sum := 0
	switch len(s) {
	case 10:
		for i, c := range s {
			n := int(c - '0')
			if c == 'X' && i == 9 {
				n = 10
			}
			if n < 0 || n > 9 && !(n == 10 && i == 9) {
				return ""
			}
			sum += n * (10 - i)
		}
		if sum%11 == 0 {
			return s
		}
	case 13:
		for i, c := range s {
			if c < '0' || c > '9' {
				return ""
			}
			weight := 1
			if i%2 == 1 {
				weight = 3
			}
			sum += int(c-'0') * weight
		}
		if sum%10 == 0 && (strings.HasPrefix(s, "978") || strings.HasPrefix(s, "979")) {
			return s
		}
	}
	return ""
}

// Search only on human capture requests. Cache bounded results and serialize
// misses at Open Library's default one-request-per-second limit.
type bookCacheEntry struct {
	items []Metadata
	at    time.Time
}
type bookSearchState struct {
	sync.Mutex
	cache map[string]bookCacheEntry
	next  time.Time
}

func (f *Fetcher) Books(ctx context.Context, query, author string) ([]Metadata, error) {
	query = strings.TrimSpace(query)
	author = strings.TrimSpace(author)
	if query == "" || len(query) > 1000 || len(author) > 1000 {
		return nil, &ValidationError{"Enter a book title, author, or ISBN (up to 1000 bytes)."}
	}
	key := query + "\x00" + author
	f.books.Lock()
	defer f.books.Unlock()
	if cached, ok := f.books.cache[key]; ok && time.Since(cached.at) < 15*time.Minute {
		return cached.items, nil
	}
	if delay := time.Until(f.books.next); delay > 0 {
		timer := time.NewTimer(delay)
		defer timer.Stop()
		select {
		case <-ctx.Done():
			return nil, ctx.Err()
		case <-timer.C:
		}
	}
	f.books.next = time.Now().Add(time.Second)
	params := url.Values{"q": {query}, "fields": {"key,title,author_name,cover_i,editions,editions.key,editions.title,editions.cover_i"}, "limit": {"5"}}
	if isbn := validISBN(query); isbn != "" {
		params.Set("q", "isbn:"+isbn)
	}
	if author != "" {
		params.Set("author", author)
	}
	result, err := f.Get(ctx, "https://openlibrary.org/search.json?"+params.Encode(), 1<<20)
	if err != nil {
		return nil, err
	}
	var data struct {
		Docs []struct {
			Key      string   `json:"key"`
			Title    string   `json:"title"`
			Authors  []string `json:"author_name"`
			Cover    int      `json:"cover_i"`
			Editions struct {
				Docs []struct {
					Key   string `json:"key"`
					Title string `json:"title"`
					Cover int    `json:"cover_i"`
				} `json:"docs"`
			} `json:"editions"`
		} `json:"docs"`
	}
	if err = json.Unmarshal(result.Body, &data); err != nil {
		return nil, err
	}
	out := []Metadata{}
	for _, doc := range data.Docs {
		key, title, cover := doc.Key, doc.Title, doc.Cover
		if len(doc.Editions.Docs) > 0 {
			e := doc.Editions.Docs[0]
			if editionKey.MatchString(e.Key) {
				key = e.Key
				title = first(e.Title, title)
				if e.Cover > 0 {
					cover = e.Cover
				}
			}
		}
		if title == "" || !(workKey.MatchString(key) || editionKey.MatchString(key)) {
			continue
		}
		m := Metadata{Title: clip(title, 1000), Author: clip(strings.Join(doc.Authors, ", "), 1000), Kind: "book", URL: "https://openlibrary.org" + key}
		if cover > 0 {
			m.CoverURL = fmt.Sprintf("https://covers.openlibrary.org/b/id/%d-L.jpg", cover)
		}
		out = append(out, m)
		if len(out) == 5 {
			break
		}
	}
	if f.books.cache == nil || len(f.books.cache) >= 32 {
		f.books.cache = map[string]bookCacheEntry{}
	}
	f.books.cache[key] = bookCacheEntry{out, time.Now()}
	return out, nil
}

func (s *Server) searchBooks(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Query  string `json:"query"`
		Author string `json:"author"`
	}
	if !decode(w, r, &in) {
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 8*time.Second)
	defer cancel()
	items, err := s.Fetcher.Books(ctx, in.Query, in.Author)
	if err != nil {
		var validation *ValidationError
		if errors.As(err, &validation) {
			respond(w, 400, nil, err)
			return
		}
		writeJSON(w, 200, struct {
			Items   []Metadata `json:"items"`
			Warning string     `json:"warning"`
		}{[]Metadata{}, "Book lookup is unavailable. You can still save and edit the details."})
		return
	}
	writeJSON(w, 200, struct {
		Items []Metadata `json:"items"`
	}{items})
}

// Publishers expose exact edition data in schema.org Book JSON-LD. Prefer it
// over a fuzzy catalogue match; never follow a remote JSON-LD context.
func structuredMetadata(doc *html.Node, base string) (Metadata, string, bool) {
	var out Metadata
	var isbn string
	found := false
	var visit func(any, int)
	text := func(v any) string { s, _ := v.(string); return s }
	var names func(any) string
	names = func(v any) string {
		switch x := v.(type) {
		case string:
			return x
		case map[string]any:
			return text(x["name"])
		case []any:
			var all []string
			for _, n := range x {
				if name := names(n); name != "" {
					all = append(all, name)
				}
			}
			return strings.Join(all, ", ")
		}
		return ""
	}
	visit = func(v any, depth int) {
		if found || depth > 20 {
			return
		}
		switch x := v.(type) {
		case []any:
			for _, v := range x {
				visit(v, depth+1)
			}
		case map[string]any:
			types := []string{text(x["@type"])}
			if list, ok := x["@type"].([]any); ok {
				for _, t := range list {
					types = append(types, text(t))
				}
			}
			for _, t := range types {
				if oneOf(strings.TrimPrefix(strings.TrimPrefix(t, "https://schema.org/"), "http://schema.org/"), "Book", "Article", "NewsArticle", "BlogPosting") {
					imageValue := x["image"]
					if list, ok := imageValue.([]any); ok && len(list) > 0 {
						imageValue = list[0]
					}
					image := text(imageValue)
					if obj, ok := imageValue.(map[string]any); ok {
						image = text(obj["url"])
					}
					kind := "article"
					title := first(text(x["headline"]), text(x["name"]))
					if strings.HasSuffix(t, "Book") {
						kind = "book"
						title = first(text(x["name"]), text(x["headline"]))
					}
					out = Metadata{Title: clip(title, 1000), Author: clip(names(x["author"]), 1000), CoverURL: safeLink(base, image), Description: clip(plain(text(x["description"])), 20000), Kind: kind}
					isbn = validISBN(text(x["isbn"]))
					found = true
					return
				}
			}
			for _, v := range x {
				visit(v, depth+1)
			}
		}
	}
	walk(doc, func(n *html.Node) {
		if n.Type == html.ElementNode && n.Data == "script" && strings.EqualFold(attr(n, "type"), "application/ld+json") {
			var raw strings.Builder
			for c := n.FirstChild; c != nil; c = c.NextSibling {
				if c.Type == html.TextNode {
					raw.WriteString(c.Data)
				}
			}
			var data any
			if json.Unmarshal([]byte(raw.String()), &data) == nil {
				visit(data, 0)
			}
		}
	})
	return out, isbn, found
}
