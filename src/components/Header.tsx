interface Props {
  eyebrow: string
  title: string
}

export function Header({ eyebrow, title }: Props) {
  return (
    <header className="static-head">
      <p className="pre">{eyebrow}</p>
      <h1>{title}</h1>
    </header>
  )
}
