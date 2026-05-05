import os
import time
from typing import Any, Dict, List, Optional, Union
import httpx

class SpidercrawlError(Exception):
    """Base error for Spidercrawl SDK"""
    pass

class SpidercrawlClient:
    def __init__(
        self,
        api_key: Optional[str] = None,
        base_url: str = "http://localhost:3200",
        timeout: float = 60.0
    ):
        self.api_key = api_key or os.environ.get("SPIDERCRAWL_API_KEY")
        self.base_url = base_url.rstrip("/")
        self.timeout = timeout
        
        headers = {}
        if self.api_key:
            headers["Authorization"] = f"Bearer {self.api_key}"
            
        self.client = httpx.Client(
            base_url=self.base_url,
            headers=headers,
            timeout=self.timeout
        )

    def _request(self, method: str, path: str, **kwargs) -> Any:
        try:
            resp = self.client.request(method, path, **kwargs)
            resp.raise_for_status()
            
            data = resp.json()
            if data.get("success") is False:
                raise SpidercrawlError(data.get("error", "API Request failed"))
                
            return data.get("data") if "data" in data else data
        except httpx.HTTPStatusError as e:
            try:
                error_data = e.response.json()
                raise SpidercrawlError(error_data.get("error", str(e)))
            except:
                raise SpidercrawlError(str(e))
        except Exception as e:
            raise SpidercrawlError(str(e))

    def scrape(
        self,
        url: str,
        formats: Optional[List[str]] = None,
        enable_vision: bool = False,
        use_browser: bool = False,
        **kwargs
    ) -> Dict[str, Any]:
        """Scrape a single URL."""
        payload = {
            "url": url,
            "formats": formats or ["markdown"],
            "enableVision": enable_vision,
            "useBrowser": use_browser,
            **kwargs
        }
        return self._request("POST", "/v1/scrape", json=payload)

    def crawl(
        self,
        url: str,
        goal: Optional[str] = None,
        max_depth: int = 3,
        max_pages: int = 50,
        formats: Optional[List[str]] = None,
        **kwargs
    ) -> Dict[str, Any]:
        """Start a new crawl job."""
        payload = {
            "url": url,
            "goal": goal,
            "maxDepth": max_depth,
            "maxPages": max_pages,
            "formats": formats or ["markdown"],
            **kwargs
        }
        return self._request("POST", "/v1/crawl", json=payload)

    def get_job(self, job_id: str) -> Dict[str, Any]:
        """Get status of a crawl job."""
        return self._request("GET", f"/v1/crawl/{job_id}")

    def wait_for_job(
        self,
        job_id: str,
        interval: float = 2.0,
        timeout: float = 600.0
    ) -> Dict[str, Any]:
        """Wait for a job to complete or fail."""
        start = time.time()
        while True:
            status = self.get_job(job_id)
            if status["status"] in ("completed", "failed"):
                return status
            
            if time.time() - start > timeout:
                raise SpidercrawlError(f"Job {job_id} timed out after {timeout}s")
                
            time.sleep(interval)

    def list_jobs(self) -> List[Dict[str, Any]]:
        """List recent crawl jobs."""
        return self._request("GET", "/v1/jobs")

    def search(
        self,
        query: str,
        job_id: Optional[str] = None,
        limit: int = 10
    ) -> List[Dict[str, Any]]:
        """Search across all jobs or within a specific job."""
        if job_id:
            return self._request(
                "POST",
                f"/v1/export/rag/{job_id}/search",
                json={"query": query, "limit": limit}
            )
        return self._request(
            "POST",
            "/v1/search",
            json={"query": query, "limit": limit}
        )

    def get_entities(self, job_id: str, type: Optional[str] = None) -> List[Dict[str, Any]]:
        """Get entities extracted from a job."""
        path = f"/v1/jobs/{job_id}/entities"
        if type:
            path += f"?type={type}"
        return self._request("GET", path)

    def create_webhook(self, url: str, event: str = "job.completed") -> Dict[str, Any]:
        """Create a webhook subscription."""
        return self._request("POST", "/v1/webhooks", json={"url": url, "event": event})

    def list_webhooks(self) -> List[Dict[str, Any]]:
        """List active webhooks."""
        return self._request("GET", "/v1/webhooks")

    def delete_webhook(self, webhook_id: str) -> bool:
        """Delete a webhook subscription."""
        res = self._request("DELETE", f"/v1/webhooks/{webhook_id}")
        return res.get("success", True)
