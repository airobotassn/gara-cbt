import { useCallback, useMemo, useRef } from 'react'
import ReactQuill from 'react-quill-new'
import 'react-quill-new/dist/quill.snow.css'
import { supabase } from '../lib/supabase'

// 공지 본문 WYSIWYG 에디터 — 비개발자(사무직)용. 문법 없이 툴바 버튼으로 서식.
// 이미지는 base64 대신 Supabase Storage(공개 버킷 notice-images)에 업로드하고 URL만 본문에 삽입.
// ⚠️ 관리자 전용이라 Admin 에서 lazy import(코드스플릿) — 공개 번들에 Quill 안 실림.

const MAX_BYTES = 5 * 1024 * 1024

// 파일 → Storage → 공개 URL. 툴바 버튼·붙여넣기·드래그앤드롭이 **같은 경로**를 타야 한다.
async function uploadImage(file: File): Promise<string> {
  if (file.size > MAX_BYTES) throw new Error('이미지는 5MB 이하만 올릴 수 있어요.')
  // 붙여넣은 스크린샷은 파일명이 없거나 확장자가 없다 → MIME 로 떨어뜨린다.
  const ext = (file.name.split('.').pop() || file.type.split('/')[1] || 'png').toLowerCase()
  const path = `${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`
  const { error } = await supabase.storage
    .from('notice-images')
    .upload(path, file, { upsert: false, contentType: file.type })
  if (error) throw error
  return supabase.storage.from('notice-images').getPublicUrl(path).data.publicUrl
}

export default function RichEditor({ value, onChange }: { value: string; onChange: (html: string) => void }) {
  // react-quill-new 의 getEditor/insertEmbed 는 타입이 헐거워 ref 는 any 로 둔다.
  const quillRef = useRef<any>(null)

  const insertImages = useCallback(async (files: File[], at?: number | null) => {
    const editor = quillRef.current?.getEditor()
    if (!editor) return
    let index = at ?? editor.getSelection(true)?.index ?? editor.getLength()
    for (const file of files) {
      try {
        const url = await uploadImage(file)
        editor.insertEmbed(index, 'image', url)
        index += 1
        editor.setSelection(index, 0)
      } catch (e) {
        alert('이미지 업로드 실패: ' + (e instanceof Error ? e.message : '알 수 없는 오류'))
      }
    }
  }, [])

  const imageHandler = useMemo(
    () => () => {
      const input = document.createElement('input')
      input.type = 'file'
      input.accept = 'image/*'
      input.onchange = () => {
        const file = input.files?.[0]
        if (file) void insertImages([file])
      }
      input.click()
    },
    [insertImages],
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
      // ⚠️ 붙여넣기(Ctrl+V)·드래그앤드롭은 **툴바 handlers 를 안 탄다.** Quill 의 Uploader 모듈이
      //    따로 처리하는데 기본 동작이 base64 를 본문에 통째로 박는 것이라, 스크린샷 한 장에
      //    공지 본문이 7.4MB 가 된 적이 있다(글자는 175자였다). 그러면 번역 요청이 거절되고
      //    공지를 여는 사람마다 그 용량을 내려받는다. 그래서 여기서 가로채 업로드로 돌린다.
      uploader: {
        // ⚠️ Quill 기본값은 png·jpeg 뿐이라 webp·gif 는 이 경로를 안 탄다 — 안 넓히면
        //    붙여넣어도 아무 일이 안 일어난다(조용한 실패). 여기 없는 형식이 HTML 로
        //    붙여넣어지는 경우는 서버가 저장 시점에 편다.
        mimetypes: ['image/png', 'image/jpeg', 'image/gif', 'image/webp'],
        handler(range: { index: number } | null, files: File[]) {
          const imgs = Array.from(files ?? []).filter((f) => f.type.startsWith('image/'))
          if (imgs.length) void insertImages(imgs, range?.index ?? null)
        },
      },
    }),
    [imageHandler, insertImages],
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
