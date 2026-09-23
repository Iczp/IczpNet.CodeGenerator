namespace Sample.Blog;

public sealed class Article : FullAuditedAggregateRoot<Guid>
{
    public string Title { get; protected set; } = string.Empty;

    public string? Content { get; protected set; }

    public ArticleStatus Status { get; protected set; }

    public DateTime? PublishTime { get; protected set; }

    public long ViewCount { get; protected set; }

    public DateTime CreationTime { get; private set; }
}

public abstract class FullAuditedAggregateRoot<TKey> where TKey : struct;

public enum ArticleStatus
{
    Draft,
    Published
}
