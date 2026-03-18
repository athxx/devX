package db

import (
	"context"
	"fmt"
	"time"

	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/mongo"
	"go.mongodb.org/mongo-driver/mongo/options"
)

type MongoQueryRequest struct {
	URI        string           `json:"uri"`
	Database   string           `json:"database"`
	Collection string           `json:"collection"`
	Action     string           `json:"action"`
	Filter     map[string]any   `json:"filter"`
	Document   map[string]any   `json:"document"`
	Documents  []map[string]any `json:"documents"`
	Update     map[string]any   `json:"update"`
	Pipeline   []map[string]any `json:"pipeline"`
	Limit      int64            `json:"limit"`
	TimeoutMs  int              `json:"timeoutMs"`
}

type MongoQueryResponse struct {
	Result     any   `json:"result"`
	DurationMs int64 `json:"durationMs"`
}

func RunMongoQuery(ctx context.Context, request MongoQueryRequest, fallbackTimeout time.Duration) (MongoQueryResponse, error) {
	if request.URI == "" || request.Database == "" || request.Collection == "" || request.Action == "" {
		return MongoQueryResponse{}, fmt.Errorf("uri, database, collection, and action are required")
	}

	timeout := fallbackTimeout
	if request.TimeoutMs > 0 {
		timeout = time.Duration(request.TimeoutMs) * time.Millisecond
	}
	timeoutCtx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()

	client, err := mongo.Connect(timeoutCtx, options.Client().ApplyURI(request.URI))
	if err != nil {
		return MongoQueryResponse{}, fmt.Errorf("connect mongo: %w", err)
	}
	defer func() {
		disconnectCtx, cancelDisconnect := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancelDisconnect()
		_ = client.Disconnect(disconnectCtx)
	}()

	collection := client.Database(request.Database).Collection(request.Collection)
	filter, err := toBSONMap(request.Filter)
	if err != nil {
		return MongoQueryResponse{}, err
	}

	start := time.Now()
	switch request.Action {
	case "findOne":
		var result map[string]any
		err := collection.FindOne(timeoutCtx, filter).Decode(&result)
		if err != nil {
			return MongoQueryResponse{}, err
		}
		return MongoQueryResponse{Result: result, DurationMs: time.Since(start).Milliseconds()}, nil
	case "findMany":
		findOptions := options.Find()
		if request.Limit > 0 {
			findOptions.SetLimit(request.Limit)
		}
		cursor, err := collection.Find(timeoutCtx, filter, findOptions)
		if err != nil {
			return MongoQueryResponse{}, err
		}
		defer cursor.Close(timeoutCtx)

		var results []map[string]any
		if err := cursor.All(timeoutCtx, &results); err != nil {
			return MongoQueryResponse{}, err
		}
		return MongoQueryResponse{Result: results, DurationMs: time.Since(start).Milliseconds()}, nil
	case "aggregate":
		pipeline, err := toPipeline(request.Pipeline)
		if err != nil {
			return MongoQueryResponse{}, err
		}
		cursor, err := collection.Aggregate(timeoutCtx, pipeline)
		if err != nil {
			return MongoQueryResponse{}, err
		}
		defer cursor.Close(timeoutCtx)

		var results []map[string]any
		if err := cursor.All(timeoutCtx, &results); err != nil {
			return MongoQueryResponse{}, err
		}
		return MongoQueryResponse{Result: results, DurationMs: time.Since(start).Milliseconds()}, nil
	case "insertOne":
		document, err := toBSONMap(request.Document)
		if err != nil {
			return MongoQueryResponse{}, err
		}
		result, err := collection.InsertOne(timeoutCtx, document)
		if err != nil {
			return MongoQueryResponse{}, err
		}
		return MongoQueryResponse{Result: fiberLikeMap("insertedId", result.InsertedID), DurationMs: time.Since(start).Milliseconds()}, nil
	case "insertMany":
		documents := make([]any, 0, len(request.Documents))
		for _, item := range request.Documents {
			document, err := toBSONMap(item)
			if err != nil {
				return MongoQueryResponse{}, err
			}
			documents = append(documents, document)
		}
		result, err := collection.InsertMany(timeoutCtx, documents)
		if err != nil {
			return MongoQueryResponse{}, err
		}
		return MongoQueryResponse{Result: fiberLikeMap("insertedIds", result.InsertedIDs), DurationMs: time.Since(start).Milliseconds()}, nil
	case "updateOne":
		update, err := toBSONMap(request.Update)
		if err != nil {
			return MongoQueryResponse{}, err
		}
		result, err := collection.UpdateOne(timeoutCtx, filter, update)
		if err != nil {
			return MongoQueryResponse{}, err
		}
		return MongoQueryResponse{Result: fiberLikeMap("matchedCount", result.MatchedCount, "modifiedCount", result.ModifiedCount), DurationMs: time.Since(start).Milliseconds()}, nil
	case "updateMany":
		update, err := toBSONMap(request.Update)
		if err != nil {
			return MongoQueryResponse{}, err
		}
		result, err := collection.UpdateMany(timeoutCtx, filter, update)
		if err != nil {
			return MongoQueryResponse{}, err
		}
		return MongoQueryResponse{Result: fiberLikeMap("matchedCount", result.MatchedCount, "modifiedCount", result.ModifiedCount), DurationMs: time.Since(start).Milliseconds()}, nil
	case "deleteOne":
		result, err := collection.DeleteOne(timeoutCtx, filter)
		if err != nil {
			return MongoQueryResponse{}, err
		}
		return MongoQueryResponse{Result: fiberLikeMap("deletedCount", result.DeletedCount), DurationMs: time.Since(start).Milliseconds()}, nil
	case "deleteMany":
		result, err := collection.DeleteMany(timeoutCtx, filter)
		if err != nil {
			return MongoQueryResponse{}, err
		}
		return MongoQueryResponse{Result: fiberLikeMap("deletedCount", result.DeletedCount), DurationMs: time.Since(start).Milliseconds()}, nil
	default:
		return MongoQueryResponse{}, fmt.Errorf("unsupported mongo action: %s", request.Action)
	}
}

func toBSONMap(value map[string]any) (bson.M, error) {
	if value == nil {
		return bson.M{}, nil
	}
	raw, err := bson.Marshal(value)
	if err != nil {
		return nil, err
	}
	var result bson.M
	if err := bson.Unmarshal(raw, &result); err != nil {
		return nil, err
	}
	return result, nil
}

func toPipeline(value []map[string]any) (mongo.Pipeline, error) {
	pipeline := make(mongo.Pipeline, 0, len(value))
	for _, stage := range value {
		raw, err := bson.Marshal(stage)
		if err != nil {
			return nil, err
		}
		var decoded bson.D
		if err := bson.Unmarshal(raw, &decoded); err != nil {
			return nil, err
		}
		pipeline = append(pipeline, decoded)
	}
	return pipeline, nil
}

func fiberLikeMap(key string, value any, more ...any) map[string]any {
	result := map[string]any{key: value}
	for index := 0; index < len(more)-1; index += 2 {
		key, ok := more[index].(string)
		if !ok {
			continue
		}
		result[key] = more[index+1]
	}
	return result
}
