package app

import (
	"context"
	"errors"
	"log/slog"
	"sync"
	"sync/atomic"
	"time"
)

type Worker struct {
	store   *Store
	fetcher *Fetcher
	trigger chan struct{}
	busy    atomic.Bool
	mu      sync.Mutex
	forced  bool
	done    chan struct{}
}

func NewWorker(store *Store, fetcher *Fetcher) *Worker {
	return &Worker{store: store, fetcher: fetcher, trigger: make(chan struct{}, 1), done: make(chan struct{})}
}
func (w *Worker) Trigger() {
	w.mu.Lock()
	defer w.mu.Unlock()
	// A scheduled pass may leave not-yet-due sources unchecked. Retain one
	// forced follow-up, but coalesce requests into a forced pass already active.
	if w.forced {
		return
	}
	select {
	case w.trigger <- struct{}{}:
	default:
	}
}
func (w *Worker) Done() <-chan struct{} { return w.done }
func (w *Worker) Run(ctx context.Context) {
	defer close(w.done)
	ticker := time.NewTicker(30 * time.Second)
	defer ticker.Stop()
	w.sync(ctx, false)
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			w.sync(ctx, false)
		case <-w.trigger:
			w.sync(ctx, true)
		}
	}
}
func (w *Worker) sync(ctx context.Context, force bool) {
	if !w.busy.CompareAndSwap(false, true) {
		return
	}
	w.mu.Lock()
	w.forced = force
	if force {
		// A request can arrive after Run receives the signal but before this
		// pass starts. It belongs to this pass, not another follow-up.
		select {
		case <-w.trigger:
		default:
		}
	}
	w.mu.Unlock()
	defer func() {
		w.mu.Lock()
		w.forced = false
		w.busy.Store(false)
		w.mu.Unlock()
	}()
	started := time.Now().UTC()
	// A pass has an upper bound even if sources are edited while it is running.
	for count := 0; count < 100 && ctx.Err() == nil; count++ {
		src, token, err := w.store.ClaimSource(ctx, force, started)
		if errors.Is(err, ErrNotFound) {
			return
		}
		if err != nil {
			slog.Error("claim source", "error", err)
			return
		}
		fetchCtx, cancel := context.WithTimeout(ctx, 45*time.Second)
		items, collectErr := w.fetcher.Collect(fetchCtx, src)
		cancel()
		finishCtx, finishCancel := context.WithTimeout(context.WithoutCancel(ctx), 10*time.Second)
		err = w.store.FinishSource(finishCtx, src, token, items, collectErr)
		finishCancel()
		if err != nil {
			slog.Error("persist source sync", "source", src.Name, "error", err)
		} else if collectErr != nil {
			slog.Warn("source sync failed", "source", src.Name, "error", collectErr)
		}
	}
}
