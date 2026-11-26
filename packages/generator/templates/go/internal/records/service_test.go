package records

import (
	"encoding/json"
	"net/url"
	"testing"
)

func TestRecordValidation(t *testing.T) {
	selected := table{"fixture", "id", []field{{"id", "integer", false, false}, {"date", "date", true, false}}}
	id, err := recordKey(selected, url.Values{"id": {"42"}})
	if err != nil || id.value != int32(42) {
		t.Fatalf("key: %v, %v", id, err)
	}
	if _, err := recordKey(selected, url.Values{"id": {"2147483648"}}); err == nil {
		t.Fatal("out of range key accepted")
	}
	for _, input := range []string{`{"id":null}`, `{"id":1,"date":"2026-02-30"}`, `{"id":1,"unknown":true}`} {
		var body map[string]json.RawMessage
		_ = json.Unmarshal([]byte(input), &body)
		if _, err := recordBody(selected, body, false); err == nil {
			t.Errorf("accepted %s", input)
		}
	}
	fields, err := recordBody(selected, map[string]json.RawMessage{"date": json.RawMessage("null")}, true)
	if err != nil || len(fields) != 1 || fields[0].value != nil {
		t.Fatalf("nullable date: %v, %v", fields, err)
	}
	if _, err := listQuery(url.Values{"limit": {"101"}}); err == nil {
		t.Fatal("out of range limit accepted")
	}
}
