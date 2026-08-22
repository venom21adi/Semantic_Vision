import os

from helper import helper


class Service:
    def run(self, value: int) -> int:
        result = helper(value)
        return os.path.abspath(str(result))

    def execute(self, value: int) -> int:
        return self.run(value)


def logged(func):
    return func


@logged
def standalone(value: int) -> int:
    return value
