package records

import "encoding/json"

type field struct {
	name, kind           string
	nullable, hasDefault bool
}

type table struct {
	name, key string
	columns   []field
}

type argument struct {
	field field
	value any
}

type listOptions struct {
	filter        string
	limit, offset int32
}

type page struct {
	Rows    []json.RawMessage `json:"rows"`
	HasMore bool              `json:"hasMore"`
}

type inputError string

func (e inputError) Error() string { return string(e) }
