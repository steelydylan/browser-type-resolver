import localforage from "localforage";

const urlMap = new Map<string, string>();

async function fetchFile(url: string): Promise<string> {
  if (urlMap.has(url)) {
    return urlMap.get(url) ?? "";
  }
  const cache = await localforage.getItem<string>('content:' + url);
  if (cache) {
    return cache;
  }
  const response = await fetch(url);
  const text = await response.text();
  await localforage.setItem('content:' + url, text);
  urlMap.set(url, text);
  return text;
}

async function fetchFileTypeUrl(url: string): Promise<string> {
  if (urlMap.has(url)) {
    return urlMap.get(url) ?? "";
  }
  const cache = await localforage.getItem<string>('types:' + url);
  if (cache) {
    return cache;
  }
  const res = await fetch(url);
  const dtsUrl = res.headers.get("x-typescript-types") ?? ""
  await localforage.setItem('types:' + url, dtsUrl);
  urlMap.set(url, dtsUrl);
  return dtsUrl;
}

function simplifyImport(input: string): string {
  const regex =
    /import\s+([\s\S]*?)\s+from\s+'https:\/\/esm\.sh\/v\d+\/(.*?)@\d.*?'/g;

  const exportRegex =
    /export\s+([\s\S]*?)\s+from\s+'https:\/\/esm\.sh\/v\d+\/(.*?)@\d.*?'/g;

  const relativeExportRegex = /export\s+([\s\S]*?)\s+from\s+['"](.*?)['"]/g;
  const relativeImportRegex = /import\s+([\s\S]*?)\s+from\s+['"](.*?)['"]/g;

  const referenceRegex =
    /\/\/\/\s+<reference\s+path="https:\/\/esm\.sh\/v\d+\/(.*?)@\d.*?"\s+\/>/g;

  const requiredRegex = /require\(['"]https:\/\/esm\.sh\/v\d+\/(.*?)@\d.*?['"]\)/g;
  return input
    .replace(regex, (url, importPart, libraryName) => {
      const parts = url.split("/");
      const filename = parts[parts.length - 1].replace("';", "");
      if (filename.includes("index.d.ts")) {
        return `import ${importPart} from '${libraryName.replace(
          /@types\//,
          ""
        )}'`;
      }
      return `import ${importPart} from '${libraryName.replace(
        /@types\//,
        ""
      )}/${filename.replace(".d.ts", "")}`;
    })
    .replace(exportRegex, (url, importPart, libraryName) => {
      const parts = url.split("/");
      const filename = parts[parts.length - 1].replace("';", "");
      if (filename.includes("index.d.ts")) {
        return `export ${importPart} from '${libraryName.replace(
          /@types\//,
          ""
        )}'`;
      }
      return `export ${importPart} from '${libraryName.replace(
        /@types\//,
        ""
      )}/${filename.replace(".d.ts", "")}`;
    })
    .replace(relativeExportRegex, (_, importPart, libraryName) => {
      return `export ${importPart} from '${libraryName.replace(".d.ts", "")}'`;
    })
    .replace(relativeImportRegex, (_, importPart, libraryName) => {
      return `import ${importPart} from '${libraryName.replace(".d.ts", "")}'`;
    })
    .replace(referenceRegex, (_, libraryName) => {
      return `/// <reference path="${libraryName.replace(/@types\//, "")}" />`;
    })
    .replace(requiredRegex, (_, libraryName) => {
      return `require('${libraryName.replace(/@types\//, "")}')`;
    });
}

function getModuleNameFromPath(path: string): string {
  const pattern =
    /https:\/\/esm\.sh\/v\d+\/(?:@types\/)?([a-z0-9-/@]+)(?:@[\^~]?[\d.]+)?(\/.*\.d\.ts)/;

  const match = path.match(pattern);
  if (match && match[1] && match[2]) {
    return `${match[1]}${match[2]}`;
  }

  return "";
}

const urlsetter = new Set<string>();
async function setDependencies({
  library,
  version,
  parentModule = '',
}:{
  library: string,
  version: string,
  parentModule: string
}): Promise<{ [key: string ]: string }> {
  const storageKey = `dependencies:${library}@${version}${parentModule}`
  const savedDependencies = await localforage.getItem(storageKey) as { [key: string]: string } | null;
  if (savedDependencies) {
    return savedDependencies;
  }
  async function processFile(
    path: string,
    dependencies: { [key: string]: string } = {}
  ): Promise<{ [key: string]: string }> {
    const moduleName = getModuleNameFromPath(path);
    const content = await fetchFile(path);
    if (!moduleName) {
      return dependencies;
    }
    if (simplifyImport(content)) {
      dependencies[moduleName] = simplifyImport(content);
    }
    // Import statements
    const importUrls = (
      content.match(
        /import [\s\S]*? from 'https:\/\/esm\.sh\/v\d+\/[^']+';/g
      ) || []
    ).map((line) => line.match(/https:\/\/esm\.sh\/[^']+/)?.[0]);

    const relativeImportUrls = (
      content.match(/import [\s\S]*? from '(\.\/[^']+)';/g) || []
    ).map((line) => line.match(/'(\.\/[^']+)'/)?.[1]);

    const exportUrls = (
      content.match(
        /export [\s\S]*? from 'https:\/\/esm\.sh\/v\d+\/[^']+';/g
      ) || []
    ).map((line) => line.match(/https:\/\/esm\.sh\/[^']+/)?.[0]);

    // grab relative imports with group
    const relativeExportUrls = (
      content.match(/export [\s\S]*? from ['"](\.\/[^'"]+)['"];/g) || []
    ).map((line) => line.match(/['"](\.\/[^'"]+)['"]/)?.[1]);

    const referencePaths = (
      content.match(
        /\/\/\/ <reference types="https:\/\/esm\.sh\/v\d+\/[^"]+" \/>/g
      ) || []
    ).map((line) => line.match(/"https:\/\/esm\.sh\/[^"]+"/)?.[0]);

    // Reference paths
    const referenceRelativePaths = (
      content.match(/\/\/\/ <reference path="[^"]+" \/>/g) || []
    ).map((line) => line.match(/"[^"]+"/)?.[0]?.replace(/"/g, ""));

    const requiredPaths = (
      content.match(
        /require\(['"]https:\/\/esm\.sh\/v\d+\/[^']+['"]\)/g
      ) || []
    ).map((line) => line.match(/'https:\/\/esm\.sh\/[^']+'/)?.[0]);

    for (const url of importUrls || []) {
      if (!url) {
        continue;
      }
      if (urlsetter.has(url)) {
        continue;
      }
      urlsetter.add(url);
      await processFile(url, dependencies);
    }

    for (const url of exportUrls || []) {
      if (!url) {
        continue;
      }
      if (urlsetter.has(url)) {
        continue;
      }
      urlsetter.add(url);
      await processFile(url ?? "", dependencies);
    }

    for (const refPath of referencePaths || []) {
      if (!refPath) {
        continue;
      }
      if (urlsetter.has(refPath)) {
        continue;
      }
      urlsetter.add(refPath);
      await processFile(refPath ?? "", dependencies);
    }

    for (const url of relativeImportUrls || []) {
      const refUrl = new URL(url ?? "", path); // Assuming relative path
      if (urlsetter.has(refUrl.toString())) {
        continue;
      }
      urlsetter.add(refUrl.toString());
      await processFile(refUrl.toString(), dependencies).catch(() => {
        // ignore
      });
    }

    for (const url of relativeExportUrls || []) {
      const refUrl = new URL(url ?? "", path); // Assuming relative path
      if (urlsetter.has(refUrl.toString())) {
        continue;
      }
      urlsetter.add(refUrl.toString());
      await processFile(refUrl.toString(), dependencies).catch(() => {
        // ignore
      });
    }

    for (const refPath of referenceRelativePaths || []) {
      const refUrl = new URL(refPath ?? "", path); // Assuming relative path
      if (urlsetter.has(refUrl.toString())) {
        continue;
      }
      urlsetter.add(refUrl.toString());
      await processFile(refUrl.toString(), dependencies).catch(() => {
        // ignore
      });
    }

    for (const url of requiredPaths || []) {
      if (!url) {
        continue;
      }
      if (urlsetter.has(url)) {
        continue;
      }
      urlsetter.add(url);

      await processFile(url ?? "", dependencies).catch(() => {
        // ignore
      });
    }

    await localforage.setItem(storageKey, dependencies);

    return dependencies;
  }

  if (parentModule) {
    const diffPath = library.replace(parentModule, "").replace("/", "");
    const dtsUrl = await fetchFileTypeUrl(
      `https://esm.sh/${parentModule}@${version}/${diffPath}`
    );
    return await processFile(dtsUrl);
  } else {
    const dtsUrl = await fetchFileTypeUrl(`https://esm.sh/${library}@${version}`);
    return await processFile(dtsUrl);
  }
}

function saveJsonParse(json: string) {
  try {
    return JSON.parse(json);
  } catch (e) {
    return {};
  }
}

export const resolveModuleType = async (
  lib: string,
  version = "latest",
) => {
  const pkgStr = await fetchFile(`https://esm.sh/${lib}@${version}/package.json`);
  const pkg = saveJsonParse(pkgStr);
  let dependencies = await setDependencies({
    library: lib,
    version,
    parentModule: "",
  });
  if (pkg.exports) {
    await Promise.all(
      Object.keys(pkg.exports).map(async (key) => {
        if (key !== "." && !key.includes('*') && key !== "./package.json") {
          const subDependencies = await setDependencies({
            library: `${lib}/${key.replace("./", "")}`,
            version,
            parentModule: lib,
          }).catch(() => {
            // ignore
          });
          if (pkg.exports[key]?.types) {
            dependencies[`${lib}/${key.replace("./", "")}/index.d.ts`] = `export * from '${lib}/${pkg.exports[key].types.replace(".d.ts", "")}'`;
          }
          if (subDependencies) {
            dependencies = { ...dependencies, ...subDependencies };
          }
        }
      })
    );
  }
  if (pkg.types && pkg.types !== "./index.d.ts") {
    dependencies[`${lib}/index.d.ts`] = `export * from './${pkg.types.replace(".d.ts", "")}'`;
  }
  return dependencies;
};

export const resolveAllModuleType = async (libs: { [key: string]: string }) => {
  let dependencies: { [key: string]: string } = {};
  await Promise.all(
    Object.keys(libs).map(async (lib) => {
      const version = libs[lib];
      const subDependencies = await resolveModuleType(lib, version);
      dependencies = { ...dependencies, ...subDependencies };
    })
  );
  return dependencies;
}
