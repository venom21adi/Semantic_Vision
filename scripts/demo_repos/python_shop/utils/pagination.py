"""Simple in-memory pagination for list endpoints."""


def paginate(items, page=1, page_size=20):
    if page < 1:
        raise ValueError("page must be >= 1")
    if page_size < 1:
        raise ValueError("page_size must be >= 1")

    start = (page - 1) * page_size
    end = start + page_size

    page_items = []
    for index, item in enumerate(items):
        if index < start:
            continue
        if index >= end:
            break
        page_items.append(item)

    total_pages = (len(items) + page_size - 1) // page_size if items else 1
    return {
        "items": page_items,
        "page": page,
        "total_pages": total_pages,
        "has_next": page < total_pages,
    }


def build_page_links(base_url, page, total_pages):
    links = {}
    if page > 1:
        links["prev"] = f"{base_url}?page={page - 1}"
    if page < total_pages:
        links["next"] = f"{base_url}?page={page + 1}"
    return links
