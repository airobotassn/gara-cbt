import { useMemo, useRef } from 'react'
import ReactQuill from 'react-quill-new'
import 'react-quill-new/dist/quill.snow.css'
import { supabase } from '../lib/supabase'

// 공지 본문 WYSIWYG 에디터 — 비개발자(사무직)용. 문법 없이 툴바 버튼으로 서식.
// 이미지는 base64 대신 Supabase Storage(공개 버킷 notice-images)에 업로드하고 URL만 본문에 삽입.
// ⚠️ 관리자 전용이라 Admin 에서 lazy import(코드스플릿) — 공개 번들에 Quill 안 실림.
export default function RichEditor({ value, onChange }: { value: string; onChange: (html: string) => void }) {
  // react-quill-new 의 getEditor/insertEmbed 는 타입이 헐거워 ref 는 any 로 둔다.
  const quillRef = useRef<any>(null)

  const imageHandler = useMemo(
    () => () => {
      const input = document.createElement('input')
      input.type = 'file'
      input.accept = 'image/*'
      input.onchange = async () => {
        const file = input.files?.[0]
        if (!file) return
        if (file.size > 5 * 1024 * 1024) {
          alert('이미지는 5MB 이하만 올릴 수 있어요.')
          return
        }
        try {
          const ext = (file.name.split('.').pop() || 'png').toLowerCase()
          const path = `${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`
          const { error } = await supabase.storage
            .from('notice-images')
            .upload(path, file, { upsert: false, contentType: file.type })
          if (error) throw error
          const { data } = supabase.storage.from('notice-images').getPublicUrl(path)
          const editor = quillRef.current?.getEditor()
          const range = editor?.getSelection(true)
          const at = range?.index ?? editor?.getLength() ?? 0
          editor?.insertEmbed(at, 'image', data.publicUrl)
          editor?.setSelection(at + 1, 0)
        } catch (e) {
          alert('이미지 업로드 실패: ' + (e instanceof Error ? e.message : '알 수 없는 오류'))
        }
      }
      input.click()
    },
    [],
  )

  const modules = useMemo(
    () => ({
      toolbar: {
        container: [
          [{ header: [2, 3, false] }, { size: ['small', false, 'large', 'huge'] }],
          ['bold', 'italic', 'underline', 'strike'],
          [{ list: 'ordered' }, { list: 'bullet' }],
          ['blockquote', 'link', 'image'],
          ['clean'],
        ],
        handlers: { image: imageHandler },
      },
    }),
    [imageHandler],
  )

  return (
    <div className="rich-editor">
      <ReactQuill
        ref={quillRef}
        theme="snow"
        value={value}
        onChange={onChange}
        modules={modules}
        placeholder="공지 본문을 작성하세요. 이미지·굵게·제목·목록 등은 위 버튼으로."
      />
    </div>
  )
}
