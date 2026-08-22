import os
from helpers import format_name


class Greeter:
    def greet(self, name: str) -> str:
        cleaned = format_name(name)
        return os.path.join(cleaned, "greeting")
