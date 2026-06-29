#!/bin/bash

mkdir -p dist

go build -ldflags="-s -w" -o dist/systray ./cmd/systray

CGO_ENABLED=0 go build -ldflags="-s -w" -o dist/cli ./cmd/cli