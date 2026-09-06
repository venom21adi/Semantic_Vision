package com.example;

import com.example.util.Formatter;
import java.util.Objects;

public class Greeter {
    public String greet(String name) {
        String cleaned = this.clean(name);
        Formatter formatter = new Formatter();
        return formatter.format(cleaned);
    }

    private String clean(String name) {
        return Objects.requireNonNull(name);
    }
}
