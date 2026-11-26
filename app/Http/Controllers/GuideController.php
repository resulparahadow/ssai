<?php

namespace App\Http\Controllers;

use Illuminate\Support\Str;
use Inertia\Inertia;
use Inertia\Response;
use League\CommonMark\GithubFlavoredMarkdownConverter;

/**
 * The chatter guide, rendered from `docs/chatter-guide.md` — the one source, so editing the file
 * updates the page. Opened from the header's Guide button on Conversations (a new tab, so the
 * open chat and any draft stay put). The file is our own repo content; raw HTML in it is still
 * escaped and unsafe links dropped, so the page only ever carries what Markdown produces.
 */
class GuideController extends Controller
{
    public const PATH = 'docs/chatter-guide.md';

    public function show(): Response
    {
        $markdown = is_file(base_path(self::PATH)) ? (string) file_get_contents(base_path(self::PATH)) : '';

        $html = (new GithubFlavoredMarkdownConverter([
            'html_input' => 'escape',
            'allow_unsafe_links' => false,
        ]))->convert($markdown)->getContent();

        [$html, $toc] = $this->anchorHeadings($html);

        return Inertia::render('Guide', [
            'html' => $html,
            'toc' => $toc,
        ]);
    }

    /**
     * Give every h2/h3 a stable id and collect them for the contents list. Ids are slugs of the
     * heading text, made unique with a counter (the guide repeats "For managers").
     *
     * @return array{0: string, 1: list<array{id: string, text: string, level: int}>}
     */
    private function anchorHeadings(string $html): array
    {
        $toc = [];
        $seen = [];

        $html = (string) preg_replace_callback('/<h([23])>(.*?)<\/h\1>/s', function (array $m) use (&$toc, &$seen): string {
            $text = html_entity_decode(strip_tags($m[2]), ENT_QUOTES | ENT_HTML5);
            $base = Str::slug($text) ?: 'section';
            $id = $base;
            for ($n = 2; isset($seen[$id]); $n++) {
                $id = $base.'-'.$n;
            }
            $seen[$id] = true;
            $toc[] = ['id' => $id, 'text' => $text, 'level' => (int) $m[1]];

            return '<h'.$m[1].' id="'.$id.'">'.$m[2].'</h'.$m[1].'>';
        }, $html);

        return [$html, $toc];
    }
}
