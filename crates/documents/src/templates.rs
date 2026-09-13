use anyhow::{Result, ensure};
use std::path::Path;

pub fn template_names(root: &Path) -> Result<Vec<String>> {
    let directory = root.join("templates");
    if !directory.exists() {
        return Ok(vec![]);
    }
    let mut names = Vec::new();
    for entry in std::fs::read_dir(directory)? {
        let entry = entry?;
        if entry.file_type()?.is_file() && entry.path().extension().is_some_and(|e| e == "md") {
            if let Some(name) = entry.file_name().to_str() {
                names.push(name.into());
            }
        }
    }
    names.sort();
    Ok(names)
}

pub fn instantiate_template(root: &Path, name: &str, title: &str) -> Result<String> {
    ensure!(
        template_names(root)?
            .iter()
            .any(|candidate| candidate == name),
        "Choose an existing Markdown template filename"
    );
    Ok(std::fs::read_to_string(root.join("templates").join(name))?.replace("{{title}}", title))
}
