package main

import (
	"fmt"
	"net/http"

	"example.com/app/internal/util"
	th "github.com/other/thing"
)

func init() {}
func init() {}

func main() {
	s := NewServer()
	s.Run()
	util.Helper()
	fmt.Println("hi")
	th.Do()
	_ = http.StatusOK
	_ = len("x")
}
