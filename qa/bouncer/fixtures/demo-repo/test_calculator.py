from calculator import add, divide, multiply, price_tag

assert add(2, 3) == 5
assert multiply(2, 3) == 6
assert divide(10, 2) == 5.0
assert price_tag(9.5) == "$9.50"
print("all tests passed")
