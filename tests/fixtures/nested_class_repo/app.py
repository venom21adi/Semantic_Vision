class Outer:
    class Inner:
        def method(self):
            return 1


def factory():
    class Local:
        def method(self):
            return 2

    return Local()
