import { useCallback, useState } from 'react'
import { importIntoStorage, isMediaFile } from '@/services/projects'
import { StorageQuotaError } from '@/services/storage'
import { useEditor } from '@/store/editorStore'
import { toast } from '@/store/toastStore'

/** Import files into the open project. `true` places them at the playhead, `'append'` joins them after the main video. */
export function useImport() {
  const [busy, setBusy] = useState(0)

  const importFiles = useCallback(async (files: File[], addToTimeline: boolean | 'append' = false) => {
    const usable = files.filter(isMediaFile)
    if (usable.length < files.length) toast.error('Some files were skipped: only video, audio and image files are supported.')
    setBusy((n) => n + usable.length)
    for (const file of usable) {
      try {
        const asset = await importIntoStorage(file)
        useEditor.getState().silent((p) => ({ ...p, assets: [...p.assets, asset] }))
        if (addToTimeline === 'append') useEditor.getState().mergeAsset(asset, 'append')
        else if (addToTimeline) useEditor.getState().addAssetToTimeline(asset)
      } catch (e) {
        toast.error(e instanceof StorageQuotaError ? e.message : e instanceof Error ? e.message : `Could not import ${file.name}.`)
      } finally {
        setBusy((n) => n - 1)
      }
    }
  }, [])

  return { importFiles, importing: busy > 0 }
}
