package app

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"net/url"
	"path"
	"sort"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/mmcdole/gofeed"
	"golang.org/x/net/html"
	"golang.org/x/net/html/charset"
)

type Metadata struct {
	Title       string `json:"title"`
	Author      string `json:"author"`
	Kind        string `json:"kind"`
	URL         string `json:"url"`
	CoverURL    string `json:"cover_url"`
	Description string `json:"description"`
	Warning     string `json:"warning,omitempty"`
}

func (f *Fetcher) Metadata(ctx context.Context, raw string) (m Metadata, err error) {
	u, err := CanonicalURL(raw)
	if err != nil {
		return Metadata{}, &ValidationError{err.Error()}
	}
	parsed, _ := url.Parse(u)
	m = Metadata{Title: fallbackTitle(u), Kind: "article", URL: u}
	if isBookHost(parsed.Hostname()) {
		m.Kind = "book"
	}
	if parsed.Hostname() == "youtube.com" || strings.HasSuffix(parsed.Hostname(), ".youtube.com") || parsed.Hostname() == "youtu.be" || parsed.Hostname() == "vimeo.com" {
		m.Kind = "video"
	}
	if strings.EqualFold(path.Ext(parsed.Path), ".pdf") {
		m.Kind = "paper"
	}
	bookISBN := ""
	structuredBook := false
	defer func() {
		if m.Kind != "book" || (m.Author != "" && m.CoverURL != "") {
			return
		}
		query := m.Title
		if bookISBN != "" {
			query = bookISBN
		}
		for _, candidate := range isbnPattern.FindAllString(parsed.Path, -1) {
			if isbn := validISBN(candidate); isbn != "" {
				query = isbn
				break
			}
		}
		lookup, cancel := context.WithTimeout(ctx, 5*time.Second)
		defer cancel()
		matches, e := f.Books(lookup, query, m.Author)
		if e == nil && len(matches) > 0 {
			best := matches[0]
			if !structuredBook {
				m.Title = best.Title
			}
			m.Author = first(m.Author, best.Author)
			m.CoverURL = first(m.CoverURL, best.CoverURL)
		}
	}()
	result, err := f.Get(ctx, u, 2<<20)
	if err != nil {
		if recovered, ok := f.publisherMetadata(ctx, u); ok {
			return recovered, nil
		}
		m.Warning = "This site did not share its page details. You can retry or add them manually."
		return m, nil
	}
	m.URL = result.URL
	if strings.Contains(strings.ToLower(result.ContentType), "application/pdf") || bytes.HasPrefix(result.Body, []byte("%PDF-")) {
		m.Kind = "paper"
		m.Warning = "PDF detected. Add the title and author manually."
		return m, nil
	}
	if result.ContentType != "" && !strings.Contains(strings.ToLower(result.ContentType), "html") && !strings.HasPrefix(strings.TrimSpace(string(result.Body)), "<") {
		m.Warning = "This URL does not contain an HTML article. Edit the details manually."
		return m, nil
	}
	doc, err := parseHTML(result)
	if err != nil {
		m.Warning = "Could not read the page. Edit the details manually."
		return m, nil
	}
	values := map[string]string{}
	var titleText, canonical string
	walk(doc, func(n *html.Node) {
		if n.Type != html.ElementNode {
			return
		}
		switch n.Data {
		case "title":
			if titleText == "" {
				titleText = nodeText(n)
			}
		case "meta":
			key := strings.ToLower(attr(n, "property"))
			if key == "" {
				key = strings.ToLower(attr(n, "name"))
			}
			if values[key] == "" {
				values[key] = strings.TrimSpace(attr(n, "content"))
			}
		case "link":
			if hasToken(attr(n, "rel"), "canonical") {
				canonical = safeLink(result.URL, attr(n, "href"))
			}
		}
	})
	if title := first(values["og:title"], values["twitter:title"], titleText); title != "" {
		m.Title = clip(title, 1000)
	}
	m.Author = clip(first(values["author"], values["article:author"], values["dc.creator"], values["dcterms.creator"]), 1000)
	m.Description = clip(first(values["og:description"], values["description"], values["twitter:description"]), 20000)
	m.CoverURL = safeLink(result.URL, first(values["og:image"], values["twitter:image"]))
	// Publishers sometimes put an unrelated canonical URL in their templates.
	// Only trust a canonical link on the page's final host (allow www aliases).
	if canonical != "" {
		a, _ := url.Parse(canonical)
		b, _ := url.Parse(result.URL)
		if strings.TrimPrefix(a.Hostname(), "www.") == strings.TrimPrefix(b.Hostname(), "www.") {
			m.URL = canonical
		}
	}
	if values["og:type"] == "book" {
		m.Kind = "book"
	}
	if strings.HasPrefix(values["og:type"], "video") {
		m.Kind = "video"
	}
	if book, isbn, ok := structuredMetadata(doc, result.URL); ok {
		bookISBN = isbn
		structuredBook = book.Title != ""
		m.Kind = book.Kind
		m.Title = first(book.Title, m.Title)
		m.Author = first(book.Author, m.Author)
		m.CoverURL = first(book.CoverURL, m.CoverURL)
		m.Description = first(book.Description, m.Description)
	}
	return m, nil
}

func fallbackTitle(raw string) string {
	parsed, _ := url.Parse(raw)
	if parsed == nil {
		return raw
	}
	title := parsed.Hostname()
	if name := path.Base(parsed.Path); name != "/" && name != "." {
		if decoded, e := url.PathUnescape(name); e == nil {
			name = decoded
		}
		title = name
		if oneOf(strings.ToLower(path.Ext(name)), ".html", ".htm", ".pdf", ".php") {
			title = strings.TrimSuffix(name, path.Ext(name))
		}
		title = strings.NewReplacer("-", " ", "_", " ").Replace(title)
	}
	return clip(title, 1000)
}

func isBookHost(host string) bool {
	host = strings.TrimPrefix(strings.ToLower(host), "www.")
	return oneOf(host, "goodreads.com", "oreilly.com", "learning.oreilly.com", "books.google.com", "openlibrary.org", "bookshop.org", "barnesandnoble.com")
}

func parseHTML(r FetchResult) (*html.Node, error) {
	reader, err := charset.NewReader(bytes.NewReader(r.Body), r.ContentType)
	if err != nil {
		return nil, err
	}
	return html.Parse(reader)
}
func attr(n *html.Node, key string) string {
	for _, a := range n.Attr {
		if a.Key == key {
			return a.Val
		}
	}
	return ""
}
func walk(n *html.Node, fn func(*html.Node)) {
	fn(n)
	for c := n.FirstChild; c != nil; c = c.NextSibling {
		walk(c, fn)
	}
}
func nodeText(n *html.Node) string {
	var b strings.Builder
	var visit func(*html.Node)
	visit = func(n *html.Node) {
		if n.Type == html.ElementNode && oneOf(n.Data, "script", "style", "noscript", "svg") {
			return
		}
		if n.Type == html.TextNode {
			b.WriteString(n.Data)
			b.WriteByte(' ')
		}
		for c := n.FirstChild; c != nil; c = c.NextSibling {
			visit(c)
		}
	}
	visit(n)
	return strings.Join(strings.Fields(b.String()), " ")
}
func plain(s string) string {
	doc, err := html.Parse(strings.NewReader(s))
	if err != nil {
		return ""
	}
	return nodeText(doc)
}
func first(values ...string) string {
	for _, v := range values {
		if strings.TrimSpace(v) != "" {
			return strings.TrimSpace(v)
		}
	}
	return ""
}
func clip(s string, n int) string {
	s = strings.ToValidUTF8(s, "")
	if len(s) <= n {
		return s
	}
	s = s[:n]
	for !utf8.ValidString(s) {
		s = s[:len(s)-1]
	}
	return s
}
func hasToken(value, token string) bool {
	for _, s := range strings.Fields(strings.ToLower(value)) {
		if s == token {
			return true
		}
	}
	return false
}

func DefaultSources() []Source {
	return []Source{
		{Name: "OpenAI", SiteURL: "https://openai.com/news/", FeedURL: "https://openai.com/news/rss.xml", Parser: "rss", Enabled: true, IntervalMinutes: 60},
		{Name: "Anthropic", SiteURL: "https://www.anthropic.com/news", FeedURL: "https://www.anthropic.com/news", Parser: "html", Enabled: true, IntervalMinutes: 60},
		{Name: "Thinking Machines Lab", SiteURL: "https://thinkingmachines.ai/blog/", FeedURL: "https://thinkingmachines.ai/blog/index.xml", Parser: "rss", Enabled: true, IntervalMinutes: 60},
		{Name: "Google DeepMind", SiteURL: "https://deepmind.google/blog/", FeedURL: "https://deepmind.google/blog/rss.xml", Parser: "rss", Enabled: true, IntervalMinutes: 60},
		{Name: "Hugging Face", SiteURL: "https://huggingface.co/blog", FeedURL: "https://huggingface.co/blog/feed.xml", Parser: "rss", Enabled: true, IntervalMinutes: 60},
	}
}

func isAnthropic(raw string) bool {
	u, err := url.Parse(raw)
	if err != nil {
		return false
	}
	return oneOf(u.Hostname(), "anthropic.com", "www.anthropic.com") && oneOf(strings.TrimRight(u.Path, "/"), "", "/news")
}

func (f *Fetcher) DiscoverSource(ctx context.Context, raw, name string, interval int) (Source, error) {
	u, err := CanonicalURL(raw)
	if err != nil {
		return Source{}, &ValidationError{err.Error()}
	}
	if err = validateSourcePatch(SourcePatch{IntervalMinutes: &interval}); err != nil {
		return Source{}, err
	}
	if len(name) > 200 {
		return Source{}, &ValidationError{"name must be at most 200 bytes"}
	}
	if isAnthropic(u) {
		if name == "" {
			name = "Anthropic"
		}
		return Source{Name: name, SiteURL: "https://www.anthropic.com/news", FeedURL: "https://www.anthropic.com/news", Parser: "html", Enabled: true, IntervalMinutes: interval}, nil
	}
	// Resolve known publisher landing pages before fetching HTML; some publishers
	// block their HTML listing or omit discovery links while serving public RSS.
	candidate, _ := url.Parse(u)
	for _, known := range DefaultSources() {
		site, _ := url.Parse(known.SiteURL)
		if known.Parser == "rss" && strings.TrimPrefix(candidate.Hostname(), "www.") == strings.TrimPrefix(site.Hostname(), "www.") && oneOf(strings.TrimRight(candidate.Path, "/"), "", "/blog", "/news") {
			u = known.FeedURL
			break
		}
	}
	res, err := f.Get(ctx, u, 8<<20)
	if err != nil {
		return Source{}, &ValidationError{"Could not fetch source: " + clip(err.Error(), 300)}
	}
	if feed, err := gofeed.NewParser().Parse(bytes.NewReader(res.Body)); err == nil {
		return sourceFromFeed(feed, res.URL, name, interval), nil
	}
	doc, err := parseHTML(res)
	if err != nil {
		return Source{}, &ValidationError{"Could not read source HTML"}
	}
	links := []string{}
	walk(doc, func(n *html.Node) {
		if n.Type == html.ElementNode && n.Data == "link" && hasToken(attr(n, "rel"), "alternate") && oneOf(strings.ToLower(strings.Split(attr(n, "type"), ";")[0]), "application/rss+xml", "application/atom+xml", "application/rdf+xml") {
			if link := safeLink(res.URL, attr(n, "href")); link != "" && len(links) < 5 {
				links = append(links, link)
			}
		}
	})
	for _, link := range links {
		feedRes, e := f.Get(ctx, link, 8<<20)
		if e != nil {
			continue
		}
		feed, e := gofeed.NewParser().Parse(bytes.NewReader(feedRes.Body))
		if e != nil {
			continue
		}
		src := sourceFromFeed(feed, feedRes.URL, name, interval)
		src.SiteURL = res.URL
		return src, nil
	}
	return Source{}, &ValidationError{"No supported RSS or Atom feed was found. Paste a feed URL or a website with a feed discovery link. Anthropic News is the supported HTML fallback."}
}

func sourceFromFeed(feed *gofeed.Feed, feedURL, name string, interval int) Source {
	u, _ := url.Parse(feedURL)
	site := safeLink(feedURL, feed.Link)
	if site == "" {
		site = u.Scheme + "://" + u.Host + "/"
	}
	return Source{Name: clip(first(name, plain(feed.Title), u.Hostname()), 200), SiteURL: site, FeedURL: feedURL, Parser: "rss", Enabled: true, IntervalMinutes: interval}
}

func ParseFeed(body []byte, base string, now time.Time) ([]InboxItem, error) {
	feed, err := gofeed.NewParser().Parse(bytes.NewReader(body))
	if err != nil {
		return nil, fmt.Errorf("invalid RSS/Atom feed: %w", err)
	}
	items := []InboxItem{}
	seen := map[string]bool{}
	// Limit processing even for unusually large feeds. Parsing is body-bounded.
	for index, item := range feed.Items {
		if index >= 500 {
			break
		}
		u := safeLink(base, item.Link)
		if u == "" {
			continue
		}
		key := urlKey(u)
		if seen[key] {
			continue
		}
		seen[key] = true
		title := clip(plain(item.Title), 1000)
		if title == "" {
			continue
		}
		published := now
		if item.PublishedParsed != nil {
			published = item.PublishedParsed.UTC()
		} else if item.UpdatedParsed != nil {
			published = item.UpdatedParsed.UTC()
		}
		author := ""
		if item.Author != nil {
			author = item.Author.Name
		}
		if author == "" && feed.Author != nil {
			author = feed.Author.Name
		}
		cover := ""
		if item.Image != nil {
			cover = safeLink(base, item.Image.URL)
		}
		if cover == "" {
			for _, enclosure := range item.Enclosures {
				if strings.HasPrefix(enclosure.Type, "image/") {
					cover = safeLink(base, enclosure.URL)
					break
				}
			}
		}
		if cover == "" {
			for _, namespace := range item.Extensions {
				for _, ext := range namespace["thumbnail"] {
					if link := safeLink(base, ext.Attrs["url"]); link != "" {
						cover = link
						break
					}
				}
			}
		}
		items = append(items, InboxItem{Title: title, Author: clip(plain(author), 1000), URL: u, CoverURL: cover, Description: clip(plain(first(item.Description, item.Content)), 20000), PublishedAt: published, PublishedUnknown: item.PublishedParsed == nil, State: "new"})
	}
	sort.SliceStable(items, func(i, j int) bool { return items[i].PublishedAt.After(items[j].PublishedAt) })
	if len(items) > 100 {
		items = items[:100]
	}
	return items, nil
}

func ParseAnthropic(body []byte, base string, now time.Time) ([]InboxItem, error) {
	if !isAnthropic(base) {
		return nil, errors.New("HTML fallback is restricted to first-party Anthropic News")
	}
	doc, err := html.Parse(bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	main := doc
	walk(doc, func(n *html.Node) {
		if n.Type == html.ElementNode && n.Data == "main" {
			main = n
		}
	})
	rows := []*html.Node{}
	walk(main, func(n *html.Node) {
		if n.Type == html.ElementNode && n.Data == "li" && attr(n, "data-listing-row") != "" {
			rows = append(rows, n)
		}
	})
	// Semantic backup for a future listing without the data attribute. Requiring
	// both a heading link and a date avoids collecting category/navigation links.
	if len(rows) == 0 {
		walk(main, func(n *html.Node) {
			if n.Type == html.ElementNode && n.Data == "li" {
				rows = append(rows, n)
			}
		})
	}
	items := []InboxItem{}
	seen := map[string]bool{}
	for _, row := range rows {
		if len(items) >= 100 {
			break
		}
		var heading *html.Node
		var dateNode *html.Node
		description := ""
		cover := ""
		walk(row, func(n *html.Node) {
			if n.Type != html.ElementNode {
				return
			}
			if heading == nil && oneOf(n.Data, "h2", "h3", "h4") {
				heading = n
			}
			if n.Data == "time" && dateNode == nil {
				dateNode = n
			}
			if n.Data == "p" {
				description = first(description, nodeText(n))
			}
			if n.Data == "img" {
				cover = first(cover, safeLink(base, attr(n, "src")))
			}
		})
		if heading == nil || dateNode == nil {
			continue
		}
		var link *html.Node
		for n := heading.Parent; n != nil && n != row; n = n.Parent {
			if n.Type == html.ElementNode && n.Data == "a" {
				link = n
				break
			}
		}
		if link == nil {
			walk(heading, func(n *html.Node) {
				if link == nil && n.Type == html.ElementNode && n.Data == "a" {
					link = n
				}
			})
		}
		if link == nil {
			continue
		}
		u := safeLink(base, attr(link, "href"))
		if u == "" {
			continue
		}
		parsed, _ := url.Parse(u)
		if !oneOf(parsed.Hostname(), "www.anthropic.com", "anthropic.com") {
			continue
		}
		key := urlKey(u)
		if seen[key] {
			continue
		}
		title := clip(nodeText(heading), 1000)
		if title == "" {
			continue
		}
		seen[key] = true
		published, dated := parseDate(first(attr(dateNode, "datetime"), nodeText(dateNode)), now)
		items = append(items, InboxItem{Title: title, Author: "Anthropic", URL: u, CoverURL: cover, Description: clip(description, 20000), PublishedAt: published, PublishedUnknown: !dated, State: "new"})
	}
	if len(items) == 0 {
		return nil, errors.New("Anthropic News markup contained no dated article rows; the fallback may need updating")
	}
	sort.SliceStable(items, func(i, j int) bool { return items[i].PublishedAt.After(items[j].PublishedAt) })
	return items, nil
}

func parseDate(s string, fallback time.Time) (time.Time, bool) {
	for _, layout := range []string{time.RFC3339, "2006-01-02", "Jan 2, 2006", "January 2, 2006", "Jan 02, 2006"} {
		if t, err := time.Parse(layout, strings.TrimSpace(s)); err == nil {
			return t.UTC(), true
		}
	}
	return fallback, false
}

func (f *Fetcher) Collect(ctx context.Context, src Source) ([]InboxItem, error) {
	res, err := f.Get(ctx, src.FeedURL, 8<<20)
	if err != nil {
		return nil, err
	}
	if src.Parser == "html" {
		return ParseAnthropic(res.Body, res.URL, time.Now().UTC())
	}
	return ParseFeed(res.Body, res.URL, time.Now().UTC())
}
