package main

import "fmt"

func Simple() int {
	return 1
}

func Branchy(a, b int, items []int) int {
	if a > 0 && b > 0 {
		fmt.Println("both")
	} else if a > 0 || b > 0 {
		return 2
	}
	for _, x := range items {
		for i := 0; i < x; i++ {
			if i == 3 {
				continue
			}
		}
	}
	switch a {
	case 1:
		return 1
	case 2, 3:
		fallthrough
	default:
		b++
	}
	return b
}

func Looper(ch chan int) {
outer:
	for {
		select {
		case v := <-ch:
			if v == 0 {
				break outer
			}
		default:
		}
	}
	defer cleanup()
}

func cleanup() {}

func init() {}

func TestSomething() {}
