package db

import (
	"bytes"
	"encoding/json"
	"strings"
)

// Shared helpers for the HTTP-based Tier-C stores (Qdrant / Weaviate / InfluxDB),
// which all speak JSON over net/http with no driver dependency.

// normalizeHTTPBase turns a user-supplied address into a clean base URL with a
// scheme and no trailing slash. A bare host gets http://; an explicit
// http(s):// prefix is preserved.
func normalizeHTTPBase(address string) string {
	base := strings.TrimSpace(address)
	if base == "" {
		return ""
	}
	if !strings.Contains(base, "://") {
		base = "http://" + base
	}
	return strings.TrimRight(base, "/")
}

// decodeJSONBody parses a JSON body, falling back to the raw string if it is not
// valid JSON (e.g. an empty 200 response).
func decodeJSONBody(raw []byte) any {
	trimmed := bytes.TrimSpace(raw)
	if len(trimmed) == 0 {
		return map[string]any{}
	}
	var decoded any
	if err := json.Unmarshal(trimmed, &decoded); err != nil {
		return string(trimmed)
	}
	return decoded
}

// jsonScalar keeps scalar values as-is and JSON-encodes nested objects/arrays so
// they fit into a single grid cell as readable text.
func jsonScalar(value any) any {
	switch value.(type) {
	case nil, bool, float64, string, json.Number:
		return value
	default:
		encoded, err := json.Marshal(value)
		if err != nil {
			return value
		}
		return string(encoded)
	}
}
