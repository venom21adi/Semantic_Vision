import java.util.Objects;

public class Service {
    int run(int value) {
        int result = Helper.helper(value);
        return Objects.requireNonNull(result);
    }

    int execute(int value) {
        return this.run(value);
    }
}

class Helper {
    static int helper(int x) {
        return x + 1;
    }
}

class Standalone {
    @Deprecated
    int value(int x) {
        return x;
    }
}
