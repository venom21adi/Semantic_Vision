def helper():
    return 1


def outer():
    def middle():
        def inner():
            class Deep:
                def method(self):
                    return helper()

            return Deep

        return inner

    return middle
