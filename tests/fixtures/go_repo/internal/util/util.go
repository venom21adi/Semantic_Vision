package util

func Helper() {
	inner()
	var t Tool
	t.Use()
}

type Tool struct{}

func (t Tool) Use() {}
