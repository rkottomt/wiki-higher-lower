// Tests for the content filter. The "allowed" cases matter as much as the blocked ones:
// a filter that removes Sussex, breast cancer, or LGBTQ topics would be its own problem.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assessArticle, isExplicitTitle, normalizeText } from '../js/safety.js';

const blocked = (article) => assessArticle(article).blocked;

test('explicit titles are blocked', () => {
  for (const title of [
    'Erection', 'Penis', 'Human penis size', 'Sexual intercourse', 'Pornography', 'Pornhub',
    'OnlyFans', 'XNXX', 'Rule 34', '69 (sex position)', 'Masturbation', 'Nudity', 'Oral sex',
  ]) {
    assert.equal(isExplicitTitle(title), true, title);
  }
});

test('explicit titles are blocked in the other six languages', () => {
  for (const title of [
    'Geschlechtsverkehr', 'Nacktheit', // de
    'Pornografía', 'Desnudez', // es
    'Rapport sexuel', 'Nudité', // fr
    'Rapporto sessuale', 'Nudità', // it
    'アダルトビデオ', '性行為', 'ポルノ', // ja
    'Ereção', 'Nudez', // pt
  ]) {
    assert.equal(isExplicitTitle(title), true, title);
  }
});

test('an innocent-looking title is caught by its description, categories, or image', () => {
  assert.equal(blocked({ title: 'Some Article', description: 'Portrayal of sexual subject matter in pornography' }), true);
  assert.equal(blocked({ title: 'Some Article', categories: ['Category:Penile erection'] }), true);
  assert.equal(blocked({ title: 'Some Person', categories: ['Category:Pornographic film actresses'] }), true);
  // The real image behind the "Erection" article, on an article whose title says nothing.
  assert.equal(blocked({ title: 'Some Article', thumbnail: 'https://thumb.wikimedia.org/.../330px-A_Erect_human_penis.JPG?utm_source=x' }), true);
});

test('assessArticle reports which signal matched', () => {
  assert.equal(assessArticle({ title: 'Erection' }).signal, 'title');
  assert.equal(assessArticle({ title: 'Foo', description: 'A pornographic film' }).signal, 'description');
  assert.equal(assessArticle({ title: 'Foo', categories: ['Category:Sex organs'] }).signal, 'category');
  assert.equal(assessArticle({ title: 'Foo', thumbnail: 'https://x/Nude_woman.jpg' }).signal, 'image');
});

test('ordinary articles are not blocked', () => {
  for (const article of [
    { title: 'Sussex' }, { title: 'Middlesex County' }, { title: 'Scunthorpe' }, // substring traps
    { title: 'Al Gore' }, { title: 'The Kinks' }, { title: 'Swinging Sixties' },
    { title: 'Sex and the City' }, { title: 'Sex Education (TV series)' }, { title: 'Sex Pistols' },
    { title: 'Breast cancer', categories: ['Category:Breast cancer', 'Category:Oncology'] },
    { title: 'Verbena', description: 'Flowering plant with erect stems' },
    { title: 'Dolly Parton', categories: ['Category:1946 births', "Category:Women's rights activists"] },
  ]) {
    assert.equal(blocked(article), false, article.title);
  }
});

test('sexual orientation and gender identity are not treated as adult content', () => {
  for (const article of [
    { title: 'Bisexuality', categories: ['Category:Bisexuality', 'Category:Sexual orientation'] },
    { title: 'Homosexuality', categories: ['Category:Homosexuality'] },
    { title: 'Asexuality', categories: ['Category:Asexuality'] },
    { title: 'Transgender', categories: ['Category:Transgender', 'Category:Gender identity'] },
    { title: 'Stonewall riots', categories: ['Category:LGBTQ history in the United States'] },
  ]) {
    assert.equal(blocked(article), false, article.title);
  }
});

test('categories describing what a work is about do not block it', () => {
  // Real examples that the first version of this filter wrongly removed.
  assert.equal(blocked({ title: 'DC (film)', categories: ['Category:Films about prostitution in India'] }), false);
  assert.equal(blocked({ title: 'Primetime (film)', categories: ['Category:Films about pedophilia'] }), false);
  assert.equal(blocked({ title: 'Chris Hansen', categories: ['Category:Anti-pedophile activism', 'Category:Child abuse in the United States'] }), false);
});

test('multi-word explicit titles are blocked in each language', () => {
  // Real titles taken from the August 2026 top-1,000 lists.
  for (const title of [
    'Penetrazione sessuale', 'Sexo anal', 'Lista de posições sexuais', '69 (posição sexual)',
    'Position sexuelle', 'Relação sexual', 'Penis des Menschen', 'Vulve humaine',
    '膣性交', '女性器', 'プレステージ (アダルトビデオ)',
  ]) {
    assert.equal(isExplicitTitle(title), true, title);
  }
});

test('single-word explicit titles are blocked exactly, without hitting longer titles', () => {
  for (const title of ['Sex', 'Sexo', 'Sexe', 'Sesso']) assert.equal(isExplicitTitle(title), true, title);
  for (const title of ['Sexo en Nueva York', 'Sex and the City', 'Sex Education (TV series)']) {
    assert.equal(isExplicitTitle(title), false, title);
  }
});

test('the noun/adjective distinction keeps ordinary titles out of the filter', () => {
  // These were all wrongly blocked by earlier versions of the patterns.
  for (const title of [
    'Nackt unter Wölfen', 'The Naked Gun', 'Desnudo bajando una escalera',
    'Orientamento sessuale', 'Orientation sexuelle', 'Educación sexual',
    'Obsession (film 2025)', 'Meghan, Duquesa de Sussex', 'Erector spinae muscles',
  ]) {
    assert.equal(isExplicitTitle(title), false, title);
  }
});

test('accents and underscores do not let anything through', () => {
  assert.equal(normalizeText('Pornografía_en_España'), 'pornografia en espana');
  assert.equal(isExplicitTitle('Pornografia'), true);
  assert.equal(isExplicitTitle('Ereção'), true);
  assert.equal(isExplicitTitle('ERECTION'), true);
});
