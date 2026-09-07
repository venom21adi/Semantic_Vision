public class Widget {
    void draw() {}

    void draw(int x) {}

    void draw(int x, int y) {}

    int plain() {
        return 1;
    }

    void useIt() {
        this.draw();
    }
}
