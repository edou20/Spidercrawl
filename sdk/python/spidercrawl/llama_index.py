from typing import Any, Dict, List, Optional
from urllib.parse import quote
from llama_index.core.readers.base import BaseReader
from llama_index.core.schema import Document

from .client import SpidercrawlClient

class SpidercrawlReader(BaseReader):
    """Spidercrawl reader.
    
    Reads pages from Spidercrawl as LlamaIndex Documents.
    """
    
    def __init__(
        self,
        api_key: Optional[str] = None,
        base_url: str = "http://localhost:3200",
    ):
        self.client = SpidercrawlClient(api_key=api_key, base_url=base_url)

    def load_data(
        self,
        url: str,
        mode: str = "scrape",
        params: Optional[Dict[str, Any]] = None
    ) -> List[Document]:
        """Load data from Spidercrawl."""
        params = params or {}
        documents = []
        
        if mode == "scrape":
            res = self.client.scrape(url, **params)
            documents.append(Document(
                text=res.get("markdown", ""),
                metadata={
                    "source": url,
                    "title": res.get("title", ""),
                    **res.get("metadata", {})
                }
            ))
        elif mode == "crawl":
            job = self.client.crawl(url, **params)
            status = self.client.wait_for_job(job["id"])
            
            # Fetch all pages
            pages = self.client._request("GET", f"/v1/jobs/{job['id']}/pages")
            for p in pages:
                encoded_url = quote(p["url"], safe="")
                detail = self.client._request("GET", f"/v1/jobs/{job['id']}/pages/{encoded_url}")
                documents.append(Document(
                    text=detail.get("markdown", ""),
                    metadata={
                        "source": p["url"],
                        "title": p.get("title", ""),
                        "job_id": job["id"],
                        **p.get("metadata", {})
                    }
                ))
                
        return documents
