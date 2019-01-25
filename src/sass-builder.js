/* globals System, document */
import fs from 'fs';
import path from 'path';
import sass from '@node/node-sass';

import CssAssetCopier from 'css-asset-copier';

import resolvePath from './resolve-path';

function injectStyle(css) {
  const style = document.createElement('style');
  style.type = 'text/css';

  if (style.styleSheet) {
    style.styleSheet.cssText = css;
  } else {
    style.appendChild(document.createTextNode(css));
  }

  const head = document.head || document.getElementsByTagName('head')[0];
  head.appendChild(style);
}

function stringifyStyle(css, minify) {
  if (minify) {
    return JSON.stringify(css);
  }

  const code = css.split(/(\r\n|\r|\n)/)
    .map(line => JSON.stringify(`${line.trimRight()}`))
    .filter(line => line !== '""')
    .join(',\n');

  return `[\n${code}\n].join('\\n')`;
}

export default async function sassBuilder(loads, compileOpts, outputOpts) {
  const pluginOptions = System.sassPluginOptions || {};

  async function compile(load) {
    // skip empty files
    if (!load.source || load.source === '') {
      return '';
    }

    // compile module
    const urlBase = `${path.dirname(load.address)}/`;
    const options = {
      outputStyle: compileOpts.minify ? 'compressed' : 'expanded',
      indentedSyntax: load.address.endsWith('.sass'),
      includePaths: [],
    };
    if (pluginOptions.sassOptions) {
      Object.assign(options, pluginOptions.sassOptions);
    }
    options.includePaths.unshift(urlBase);
    options.outputStyle = compileOpts.minify ? 'compressed' : 'expanded';
    options.indentedSyntax = load.address.endsWith('.sass');
    options.outFile = outputOpts.outFile;
    options.file = load.name;

    let text = await new Promise((resolve, reject) => {
      sass.render(options, (err, res) => {
        if (err) {
          reject(err);
        } else {
          resolve(res.css.toString());
        }
      });
    });

    // rewrite urls and copy assets if enabled
    if (pluginOptions.rewriteUrl) {
      const CssUrlRewriterModule = await System.import('css-url-rewriter-ex', __moduleName);
      const CssUrlRewriter = CssUrlRewriterModule.default;
      const urlRewriter = new CssUrlRewriter({ root: System.baseURL });
      text = urlRewriter.rewrite(load.address, text);
      if (pluginOptions.copyAssets) {
        const copyTarget = path.dirname(compileOpts.outFile);
        const copier = new CssAssetCopier(copyTarget);
        await copier.copyAssets(urlRewriter.getLocalAssetList());
      }
    }

    // apply autoprefixer if enabled
    if (pluginOptions.autoprefixer) {
      const autoprefixerOptions = pluginOptions.autoprefixer instanceof Object
        ? pluginOptions.autoprefixer
        : undefined;
      const postcss = await System.import('postcss', __moduleName);
      const autoprefixer = await System.import('autoprefixer', __moduleName);
      const { css } = await postcss([autoprefixer(autoprefixerOptions)]).process(text);
      text = css;
    }

    return text;
  }

  // compile and merge styles for each module
  let styles = [];
  for (const load of loads) {
    styles.push(await compile(load));
  }
  styles = styles.join('');

  // bundle css in separate file
  if (System.separateCSS) {
    const outFile = path.resolve(outputOpts.outFile).replace(/\.js$/, '.css');
    fs.writeFileSync(outFile, styles);
    return '';
  }

  // bundle inline css
  return [
    `(${injectStyle.toString()})`,
    `(${stringifyStyle(styles, compileOpts.minify)});`,
  ].join('\n');
}
