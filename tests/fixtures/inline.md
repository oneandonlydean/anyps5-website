**Update:**
With #11588 and #11620 (`feat(libSceAppContent): support download0-2 partitions and expand`), the previous roadblock (`sceAppContentDownload2Expand not implemented` when accessing `/download2`) is resolved.

* **Furthest Point:** Stop Before First Frame
* **Status:**
  - Vulkan presentation surface and 1484x835 swapchain initialize on the GPU (AMD Radeon RX 5700 XT).
  - SDL audio subsystem and Bink video threads start.
  - The fastfile loader enters `DB_LoadFastfiles: code_post_gfx, code_reloadable`, extracts and initializes the 25 `.xpak` caches in `/download0/xpak_cache/`, and starts asset processing.
  - No frame presented to screen yet.
* **Open PRs:** #11588, #11620