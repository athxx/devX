package db

import (
	"context"
	"fmt"
	"strings"
	"time"

	"gorm.io/driver/mysql"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
)

type SQLQueryRequest struct {
	Driver       string `json:"driver"`
	DSN          string `json:"dsn"`
	Query        string `json:"query"`
	MaxOpenConns int    `json:"maxOpenConns"`
	MaxIdleConns int    `json:"maxIdleConns"`
	TimeoutMs    int    `json:"timeoutMs"`
}

type SQLQueryResponse struct {
	Columns      []string         `json:"columns,omitempty"`
	Rows         []map[string]any `json:"rows,omitempty"`
	AffectedRows int64            `json:"affectedRows,omitempty"`
	LastInsertID int64            `json:"lastInsertId,omitempty"`
	DurationMs   int64            `json:"durationMs"`
}

func QuerySQL(ctx context.Context, request SQLQueryRequest, fallbackTimeout time.Duration) (SQLQueryResponse, error) {
	if strings.TrimSpace(request.Query) == "" {
		return SQLQueryResponse{}, fmt.Errorf("query is required")
	}
	if strings.TrimSpace(request.DSN) == "" {
		return SQLQueryResponse{}, fmt.Errorf("dsn is required")
	}

	timeout := fallbackTimeout
	if request.TimeoutMs > 0 {
		timeout = time.Duration(request.TimeoutMs) * time.Millisecond
	}
	timeoutCtx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()

	dialector, err := buildDialector(request.Driver, request.DSN)
	if err != nil {
		return SQLQueryResponse{}, err
	}

	gormDB, err := gorm.Open(dialector, &gorm.Config{})
	if err != nil {
		return SQLQueryResponse{}, fmt.Errorf("open database: %w", err)
	}

	sqlDB, err := gormDB.DB()
	if err != nil {
		return SQLQueryResponse{}, fmt.Errorf("access sql db: %w", err)
	}
	defer sqlDB.Close()

	if request.MaxOpenConns > 0 {
		sqlDB.SetMaxOpenConns(request.MaxOpenConns)
	}
	if request.MaxIdleConns > 0 {
		sqlDB.SetMaxIdleConns(request.MaxIdleConns)
	}

	start := time.Now()
	queryType := classifySQL(request.Query)
	if queryType == "query" {
		rows, err := gormDB.WithContext(timeoutCtx).Raw(request.Query).Rows()
		if err != nil {
			return SQLQueryResponse{}, err
		}
		defer rows.Close()

		columns, err := rows.Columns()
		if err != nil {
			return SQLQueryResponse{}, err
		}

		resultRows := make([]map[string]any, 0)
		for rows.Next() {
			values := make([]any, len(columns))
			pointers := make([]any, len(columns))
			for index := range values {
				pointers[index] = &values[index]
			}

			if err := rows.Scan(pointers...); err != nil {
				return SQLQueryResponse{}, err
			}

			row := make(map[string]any, len(columns))
			for index, column := range columns {
				row[column] = normalizeSQLValue(values[index])
			}
			resultRows = append(resultRows, row)
		}

		return SQLQueryResponse{
			Columns:    columns,
			Rows:       resultRows,
			DurationMs: time.Since(start).Milliseconds(),
		}, rows.Err()
	}

	result := gormDB.WithContext(timeoutCtx).Exec(request.Query)
	if result.Error != nil {
		return SQLQueryResponse{}, result.Error
	}

	return SQLQueryResponse{
		AffectedRows: result.RowsAffected,
		LastInsertID: 0,
		DurationMs:   time.Since(start).Milliseconds(),
	}, nil
}

func buildDialector(driver, dsn string) (gorm.Dialector, error) {
	switch strings.ToLower(strings.TrimSpace(driver)) {
	case "mysql":
		return mysql.Open(dsn), nil
	case "postgres", "postgresql":
		return postgres.Open(dsn), nil
	default:
		return nil, fmt.Errorf("unsupported sql driver: %s", driver)
	}
}

func classifySQL(query string) string {
	normalized := strings.TrimSpace(strings.ToLower(query))
	switch {
	case strings.HasPrefix(normalized, "select"),
		strings.HasPrefix(normalized, "show"),
		strings.HasPrefix(normalized, "describe"),
		strings.HasPrefix(normalized, "desc"),
		strings.HasPrefix(normalized, "with"),
		strings.HasPrefix(normalized, "explain"):
		return "query"
	default:
		return "exec"
	}
}

func normalizeSQLValue(value any) any {
	switch typed := value.(type) {
	case []byte:
		return string(typed)
	default:
		return typed
	}
}
