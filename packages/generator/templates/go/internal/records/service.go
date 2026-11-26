package records

import (
	"encoding/json"
	"net/url"
	"regexp"
	"strconv"
	"strings"
	"time"
)

var uuid = regexp.MustCompile(`(?i)^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$`)

func validate(f field, raw json.RawMessage) (any, error) {
	if string(raw) == "null" {
		if f.nullable {
			return nil, nil
		}
		return nil, inputError("Provide a value for " + f.name + ".")
	}
	switch f.kind {
	case "smallint":
		var value int16
		if json.Unmarshal(raw, &value) == nil {
			return value, nil
		}
	case "integer":
		var value int32
		if json.Unmarshal(raw, &value) == nil {
			return value, nil
		}
	case "boolean":
		var value bool
		if json.Unmarshal(raw, &value) == nil {
			return value, nil
		}
	case "text", "uuid", "date":
		var value string
		if json.Unmarshal(raw, &value) == nil {
			valid := len(value) <= 4000 && !strings.ContainsRune(value, 0)
			if f.kind == "uuid" {
				valid = uuid.MatchString(value)
			}
			if f.kind == "date" {
				date, err := time.Parse("2006-01-02", value)
				valid = err == nil && date.Year() > 0 && date.Format("2006-01-02") == value
			}
			if valid {
				return value, nil
			}
		}
	}
	return nil, inputError("Provide a valid " + f.kind + " value for " + f.name + ".")
}

func recordKey(t table, query url.Values) (argument, error) {
	if len(query) != 1 || len(query["id"]) != 1 {
		return argument{}, inputError("Provide exactly one record ID.")
	}
	for _, f := range t.columns {
		if f.name == t.key {
			id := query.Get("id")
			raw := []byte(id)
			if f.kind != "integer" && f.kind != "smallint" {
				raw, _ = json.Marshal(id)
			}
			value, err := validate(f, raw)
			return argument{f, value}, err
		}
	}
	return argument{}, inputError("Record key is unavailable.")
}

func recordBody(t table, body map[string]json.RawMessage, update bool) ([]argument, error) {
	if body == nil {
		return nil, inputError("Provide a JSON object.")
	}
	values := make([]argument, 0, len(body))
	for _, f := range t.columns {
		raw, present := body[f.name]
		if !present {
			if !update && !f.nullable && !f.hasDefault {
				return nil, inputError("Provide a value for " + f.name + ".")
			}
			continue
		}
		if update && f.name == t.key {
			return nil, inputError("The record ID cannot be changed.")
		}
		value, err := validate(f, raw)
		if err != nil {
			return nil, err
		}
		values = append(values, argument{f, value})
	}
	if len(values) != len(body) || (update && len(values) == 0) {
		return nil, inputError("Provide supported editable fields.")
	}
	return values, nil
}

func listQuery(query url.Values) (listOptions, error) {
	for name, items := range query {
		if len(items) != 1 || (name != "q" && name != "limit" && name != "offset") {
			return listOptions{}, inputError("Provide a valid list filter.")
		}
	}
	result := listOptions{filter: query.Get("q"), limit: 25}
	if len(result.filter) > 600 || strings.ContainsRune(result.filter, 0) {
		return listOptions{}, inputError("Provide a valid list filter.")
	}
	for _, item := range []struct {
		name     string
		min, max int64
		target   *int32
	}{{"limit", 1, 100, &result.limit}, {"offset", 0, 10000, &result.offset}} {
		if query.Has(item.name) {
			value, err := strconv.ParseInt(query.Get(item.name), 10, 32)
			if err != nil || value < item.min || value > item.max {
				return listOptions{}, inputError("Provide valid pagination values.")
			}
			*item.target = int32(value)
		}
	}
	return result, nil
}
