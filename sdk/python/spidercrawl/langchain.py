from typing import Any, Dict, Iterator, List, Optional
from urllib.parse import quote
from langchain_core.document_loaders import BaseLoader
from langchain_core.documents import Document
from langchain_core.retrievers import BaseRetriever
from langchain_core.callbacks import CallbackManagerForRetrieverRun

from .client import SpidercrawlClient

class SpidercrawlLoader(BaseLoader):
    """Load data from Spidercrawl.
    
    It can either scrape a single URL or run a crawl job and load all its pages.
    """
    
    def __init__(
        self,
        url: str,
        mode: str = "scrape",
        api_key: Optional[str] = None,
        base_url: str = "http://localhost:3200",
        params: Optional[Dict[str, Any]] = None
    ):
        self.url = url
        self.mode = mode
        self.client = SpidercrawlClient(api_key=api_key, base_url=base_url)
        self.params = params or {}

    def lazy_load(self) -> Iterator[Document]:
        if self.mode == "scrape":
            res = self.client.scrape(self.url, **self.params)
            yield Document(
                page_content=res.get("markdown", ""),
                metadata={
                    "source": self.url,
                    "title": res.get("title", ""),
                    **res.get("metadata", {})
                }
            )
        elif self.mode == "crawl":
            # Start crawl
            job = self.client.crawl(self.url, **self.params)
            # Wait for completion
            status = self.client.wait_for_job(job["id"])
            
            # Fetch all pages
            # Note: We need a direct 'get_pages' method or use the results in status
            # For now, we assume status['results'] contains the data or we fetch them
            pages = self.client._request("GET", f"/v1/jobs/{job['id']}/pages")
            for p in pages:
                # Page detail for markdown
                encoded_url = quote(p["url"], safe="")
                detail = self.client._request("GET", f"/v1/jobs/{job['id']}/pages/{encoded_url}")
                yield Document(
                    page_content=detail.get("markdown", ""),
                    metadata={
                        "source": p["url"],
                        "title": p.get("title", ""),
                        "job_id": job["id"],
                        **p.get("metadata", {})
                    }
                )

class SpidercrawlRetriever(BaseRetriever):
    """Retriever for Spidercrawl semantic search."""
    
    client: Any
    job_id: Optional[str] = None
    limit: int = 5
    
    def _get_relevant_documents(
        self, query: str, *, run_manager: CallbackManagerForRetrieverRun
    ) -> List[Document]:
        results = self.client.search(query, job_id=self.job_id, limit=self.limit)
        docs = []
        for r in results:
            docs.append(Document(
                page_content=r.get("content") or r.get("markdown") or "",
                metadata={
                    "source": r.get("url"),
                    "title": r.get("title"),
                    "similarity": r.get("similarity"),
                    "search_type": r.get("searchType")
                }
            ))
        return docs
