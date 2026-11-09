import { useState } from 'react'
import Button from '@mui/material/Button'
import Menu from '@mui/material/Menu'
import MenuItem from '@mui/material/MenuItem'
import TranslateIcon from '@mui/icons-material/Translate'
import { useTranslation } from 'react-i18next'
import { LOCALES, LOCALE_NAMES, currentLocale } from '../../i18n'
import { chooseLocale } from './chooseLocale'

/** Compact top-bar button showing the current language; opens a menu with every locale. */
export function LanguageMenu() {
  const { t } = useTranslation()
  const [anchor, setAnchor] = useState<HTMLElement | null>(null)
  const active = currentLocale()
  const close = (): void => setAnchor(null)
  return (
    <>
      <Button
        variant="text"
        size="small"
        color="inherit"
        startIcon={<TranslateIcon fontSize="small" />}
        aria-label={`${t('common.language.change')}: ${LOCALE_NAMES[active]}`}
        aria-controls={anchor ? 'language-menu' : undefined}
        aria-haspopup="true"
        aria-expanded={anchor ? 'true' : undefined}
        onClick={(e) => setAnchor(e.currentTarget)}
        sx={{ whiteSpace: 'nowrap', fontWeight: 600, textTransform: 'none' }}
      >
        {LOCALE_NAMES[active]}
      </Button>
      <Menu id="language-menu" anchorEl={anchor} open={anchor !== null} onClose={close}>
        {LOCALES.map((l) => (
          <MenuItem
            key={l}
            lang={l}
            selected={l === active}
            onClick={() => {
              chooseLocale(l)
              close()
            }}
          >
            {LOCALE_NAMES[l]}
          </MenuItem>
        ))}
      </Menu>
    </>
  )
}
