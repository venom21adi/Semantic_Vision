package com.example.util;

public class Formatter {
    public String format(String name) {
        if (name == null) {
            throw new IllegalArgumentException("name must not be null");
        }
        return "Hello, " + name;
    }
}
