package main

type Server struct {
	name string
	Base
}

type Handler interface {
	Handle() error
}

func NewServer() *Server {
	return &Server{name: "x"}
}

func (s *Server) Run() {
	s.setup()
	s.client.Do()
	defer cleanup()
}
