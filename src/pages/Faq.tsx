import HomeLink from '../components/HomeLink'
import { useT } from '../lib/i18n'

const FAQ = ['q1', 'q2', 'q3', 'q4', 'q5', 'q6', 'q7']

export default function Faq() {
  const { t } = useT()
  return (
    <div className="wrap page">
      <HomeLink />
      <h1 className="page-title">{t('faq.title')}</h1>
      <div className="faq-list">
        {FAQ.map((id) => (
          <details key={id} className="faq-item">
            <summary>
              <span className="faq-q">Q. {t(`faq.${id}.q`)}</span>
            </summary>
            <p className="faq-a">{t(`faq.${id}.a`)}</p>
          </details>
        ))}
      </div>
    </div>
  )
}
