using System;
using System.Threading.Tasks;

namespace Shop.Util;

public abstract class Entity
{
    public void MarkSaved()
    {
    }
}

public class Repo<T> where T : Entity
{
    public Task SaveAsync(T item)
    {
        item.MarkSaved();
        return Task.CompletedTask;
    }

    public Task<T> GetAsync(int id) => Task.FromResult(Make(id));

    private T Make(int id) => throw new NotImplementedException();
}

public class Repo<T, TId> where T : Entity
{
    public void Touch(T item)
    {
        item.MarkSaved();
    }
}
