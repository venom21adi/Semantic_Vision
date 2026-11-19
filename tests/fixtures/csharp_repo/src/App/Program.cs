using Shop.Services;

var svc = new OrderService(new Shop.Util.Repo<Shop.Models.Order>());
var order = await svc.CreateAsync("abc", 2);
System.Console.WriteLine(order.Total);
