FROM node:26-alpine AS web
WORKDIR /build/web
RUN npm install --global pnpm@12.11.2
COPY web/package.json web/pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY web/ ./
RUN pnpm build

FROM golang:1.27-alpine AS api
WORKDIR /build/backend
COPY backend/go.mod backend/go.sum ./
RUN go mod download
COPY backend/ ./
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /margin ./cmd/server

FROM scratch
COPY --from=api /etc/ssl/certs/ca-certificates.crt /etc/ssl/certs/
COPY --from=api /margin /margin
COPY --from=web /build/web/dist /app/web
ENV PORT=8080 STATIC_DIR=/app/web
USER 65532:65532
EXPOSE 8080
ENTRYPOINT ["/margin"]
